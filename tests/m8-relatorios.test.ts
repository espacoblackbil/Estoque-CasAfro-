import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { novoCenario, type Cenario } from "./helpers";
import { criarProduto, salvarFornecedor } from "@/server/services/cadastros";
import { corrigirMovimentacao, registrarEntrada, registrarSaida } from "@/server/services/estoque";
import { devolverVenda, registrarVenda } from "@/server/services/vendas";
import { registrarPagamentoComissao } from "@/server/services/comissoes";
import { emitirRelatorio, fechamento, listarEmissoes, obterPdf } from "@/server/services/relatorios";
import { formatarBRL } from "@/domain/money";
import { movimentacoes, relatorioEmissoes, vendaDevolucoes, vendaItens, vendas } from "@/server/db/schema";

const SET = { de: "2026-09-01", ate: "2026-09-30" };

function textoDoPdf(pdf: Buffer): string {
  const arq = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "casafro-")), "r.pdf");
  fs.writeFileSync(arq, pdf);
  return execFileSync("pdftotext", ["-layout", arq, "-"]).toString("utf8").replace(/ /g, " ");
}
let temPdftotext = true;
try { execFileSync("pdftotext", ["-v"], { stdio: "ignore" }); } catch { temPdftotext = false; }
const brl = (c: number) => formatarBRL(c).replace(/ /g, " ");

describe("M8 · relatórios PDF, versões e retificação", () => {
  let c: Cenario;
  let fornId: number, oleo: number, danoId: number;

  beforeAll(async () => {
    c = await novoCenario();
    fornId = (await salvarFornecedor(c.db, c.admin, { nome: "Ayo Cosméticos", documento: "41.915.055/0001-09", telefone: "(71) 98888-7777" })).id;
    oleo = (await criarProduto(c.db, c.admin, { nome: "Óleo de Coco", modalidade: "consignado", fornecedorId: fornId, precoVendaCents: 5000, repasseCents: 3000, comissaoBps: 1000 })).id;
    const mascara = (await criarProduto(c.db, c.admin, { nome: "Máscara Nutritiva", modalidade: "proprio", precoVendaCents: 6000, comissaoBps: 500 })).id;
    await registrarEntrada(c.db, c.admin, { produtoId: oleo, quantidade: 10, dataEfetiva: "2026-09-01" });
    await registrarEntrada(c.db, c.admin, { produtoId: mascara, quantidade: 10, custoUnitarioCents: 2000, dataEfetiva: "2026-09-01" });
    const { venda } = await registrarVenda(c.db, c.admin, {
      chaveIdempotencia: "rel-venda-a", colaboradorId: c.colab.id, dataEfetiva: "2026-09-05", cliente: "Joana",
      itens: [{ produtoId: oleo, quantidade: 2 }, { produtoId: mascara, quantidade: 1 }], descontoTotalCents: 1000,
      pagamentos: [{ forma: "pix", valorCents: 10000 }, { forma: "dinheiro", valorCents: 5000 }],
    });
    await registrarSaida(c.db, c.admin, { produtoId: oleo, tipo: "consumo_interno", quantidade: 1, dataEfetiva: "2026-09-10" });
    await registrarSaida(c.db, c.admin, { produtoId: oleo, tipo: "devolucao_fornecedor", quantidade: 2, dataEfetiva: "2026-09-11" });
    danoId = (await registrarSaida(c.db, c.admin, { produtoId: oleo, tipo: "dano", quantidade: 1, dataEfetiva: "2026-09-12" })).id;
    const [it] = await c.db.select().from(vendaItens).where(eq(vendaItens.vendaId, venda.id)).orderBy(vendaItens.id);
    await devolverVenda(c.db, c.admin, venda.id, { itens: [{ vendaItemId: it.id, quantidade: 1 }], dataEfetiva: "2026-09-20", justificativa: "Defeito" });
    await registrarPagamentoComissao(c.db, c.admin, { colaboradorId: c.colab.id, valorCents: 500, dataEfetiva: "2026-09-30", observacao: "Pix parcial" });
  });

  it("colaborador não emite relatórios", async () => {
    await expect(emitirRelatorio(c.db, c.colab, { tipo: "geral", periodo: SET })).rejects.toThrow("permissão");
    await expect(emitirRelatorio(c.db, c.colab, { tipo: "colaborador", escopoId: c.colab.id, periodo: SET })).rejects.toThrow("permissão");
  });

  it("critério 10 — totais do relatório geral batem com a base de dados e com o PDF", async () => {
    const { emissao, nova } = await emitirRelatorio(c.db, c.admin, { tipo: "geral", periodo: SET });
    expect(nova).toBe(true);
    expect(emissao).toMatchObject({ versao: 1, retificado: false });
    // conferência independente direto nas tabelas
    const [v] = await c.db.select({ liq: sql<number>`sum(${vendaItens.liquidoCents})::int` }).from(vendaItens)
      .innerJoin(vendas, eq(vendas.id, vendaItens.vendaId)).where(and(gte(vendas.dataEfetiva, SET.de), lte(vendas.dataEfetiva, SET.ate)));
    const [d] = await c.db.select({ liq: sql<number>`sum(${vendaDevolucoes.liquidoCents})::int` }).from(vendaDevolucoes);
    const [m] = await c.db.select({ rep: sql<number>`sum(${movimentacoes.repasseTotalCents})::int` }).from(movimentacoes)
      .where(and(eq(movimentacoes.anulada, false), gte(movimentacoes.dataEfetiva, SET.de), lte(movimentacoes.dataEfetiva, SET.ate)));
    const t = (emissao.dados as { totais: Record<string, number> }).totais;
    expect(t.receitaLiquidaCents).toBe(v.liq - d.liq);
    expect(t.repasseDevidoTotalCents).toBe(m.rep);
    expect(t.repasseDevidoTotalCents).toBe(6000 + 3000 + 3000 - 3000); // venda + consumo + dano − devolução; devolução ao fornecedor = 0
    expect(t.resultadoEstimadoCents).toBe(10312 - 2000 - 3000 - 750 - 3000 - 3000);

    const { pdf, nome } = await obterPdf(c.db, c.admin, emissao.id);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(nome).toBe("casafro-geral-2026-09-01_2026-09-30-v1.pdf");
    if (temPdftotext) {
      const txt = textoDoPdf(pdf);
      expect(txt).toContain("Relatório geral");
      expect(txt).toContain("41.915.055/0001-09");
      expect(txt).toContain("01/09/2026 a 30/09/2026");
      expect(txt).toContain("Emitido em");
      expect(txt).toContain(brl(t.receitaLiquidaCents));
      expect(txt).toContain(brl(t.resultadoEstimadoCents));
      expect(txt).toContain(brl(t.repasseDevidoTotalCents));
      expect(txt).not.toContain("RETIFICADO");
    }
  });

  it("relatório do fornecedor lista só o que gerou repasse, por origem", async () => {
    const { emissao } = await emitirRelatorio(c.db, c.admin, { tipo: "fornecedor", escopoId: fornId, periodo: SET });
    const dados = emissao.dados as { totais: Record<string, number>; linhas: { tipo: string; totalCents: number; quantidade: number }[] };
    expect(dados.linhas.map((l) => l.tipo)).toEqual(["venda", "consumo_interno", "dano", "devolucao_venda"]);
    expect(dados.linhas.some((l) => l.tipo === "devolucao_fornecedor" || l.tipo === "entrada")).toBe(false);
    expect(dados.totais).toMatchObject({ vendasCents: 3000, consumoCents: 3000, perdasDanosCents: 3000, totalCents: 9000 });
    if (temPdftotext) {
      const txt = textoDoPdf((await obterPdf(c.db, c.admin, emissao.id)).pdf);
      expect(txt).toContain("Prestação de contas ao fornecedor");
      expect(txt).toContain("Ayo Cosméticos");
      expect(txt).toContain("Consumo interno");
      expect(txt).toContain("Total geral devido");
      expect(txt).toContain(brl(9000));
      expect(txt).not.toContain("Devolução ao fornecedor");
    }
  });

  it("relatório do colaborador: vendas, comissões, pagamentos, ajustes e saldo", async () => {
    const { emissao } = await emitirRelatorio(c.db, c.admin, { tipo: "colaborador", escopoId: c.colab.id, periodo: SET });
    const t = (emissao.dados as { totais: Record<string, number> }).totais;
    // comissões: óleo 938 + máscara 281 = 1219; devolução estorna 469 do pendente; pago 500
    expect(t).toMatchObject({ comissaoGeradaCents: 1219, estornosCents: -469, ajustesNegativosCents: 0, pagoCents: 500, saldoPendenteCents: 250, vendasLiquidasCents: 10312 });
    if (temPdftotext) {
      const txt = textoDoPdf((await obterPdf(c.db, c.admin, emissao.id)).pdf);
      expect(txt).toContain("Carla Colab");
      expect(txt).toContain(brl(250));
      expect(txt).toContain("Pix parcial");
    }
  });

  it("critério 8 — corrigir movimentação anterior gera relatório retificado e preserva a versão anterior", async () => {
    const reemissao = await emitirRelatorio(c.db, c.admin, { tipo: "geral", periodo: SET });
    expect(reemissao.nova).toBe(false); // nada mudou → mesma versão
    const v1 = reemissao.emissao;

    await corrigirMovimentacao(c.db, c.admin, danoId, { quantidade: 2, dataEfetiva: "2026-09-12", justificativa: "Eram 2 frascos danificados" });
    const { emissao: v2, nova } = await emitirRelatorio(c.db, c.admin, { tipo: "geral", periodo: SET });
    expect(nova).toBe(true);
    expect(v2).toMatchObject({ versao: 2, retificado: true });
    const alt = v2.alteracoes as { totais: { campo: string; antes: number; depois: number }[]; registros: { acao: string; justificativa: string }[] };
    expect(alt.totais).toContainEqual({ campo: "perdasDanosCents", antes: 3000, depois: 6000 });
    expect(alt.totais).toContainEqual({ campo: "resultadoEstimadoCents", antes: -1438, depois: -4438 });
    expect(alt.registros.some((r) => r.acao === "corrigir_movimentacao" && r.justificativa.includes("2 frascos"))).toBe(true);

    // versão 1 continua intacta e disponível
    const [orig] = await c.db.select().from(relatorioEmissoes).where(eq(relatorioEmissoes.id, v1.id));
    expect(orig.hashDados).toBe(v1.hashDados);
    expect((await obterPdf(c.db, c.admin, v1.id)).pdf.length).toBeGreaterThan(1000);
    await expect(c.db.execute(sql`delete from relatorio_emissoes`)).rejects.toThrow();
    await expect(c.db.execute(sql`update relatorio_emissoes set versao = 9`)).rejects.toThrow();

    if (temPdftotext) {
      const txt = textoDoPdf((await obterPdf(c.db, c.admin, v2.id)).pdf);
      expect(txt).toContain("RELATÓRIO RETIFICADO");
      expect(txt).toContain("Eram 2 frascos danificados");
      expect(txt).toContain(brl(-4438));
    }
  });

  it("Central de Relatórios — fechamento emite o pacote completo", async () => {
    const r = await fechamento(c.db, c.admin, SET);
    const tipos = r.map((x) => `${x.emissao.tipo}:${x.emissao.escopoId}`).sort();
    expect(tipos).toEqual([`colaborador:${c.colab.id}`, "comissoes:0", `fornecedor:${fornId}`, "geral:0"].sort());
    const lista = await listarEmissoes(c.db, c.admin);
    expect(lista.some((l) => l.tipo === "fornecedor" && l.escopo === "Ayo Cosméticos")).toBe(true);
    // relatórios sem alterações não geram novas versões
    const r2 = await fechamento(c.db, c.admin, SET);
    expect(r2.every((x) => !x.nova)).toBe(true);
  });
});
