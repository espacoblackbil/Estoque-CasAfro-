import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { novoCenario, type Cenario } from "./helpers";
import { criarProduto, salvarCategoria, salvarFornecedor } from "@/server/services/cadastros";
import { registrarEntrada, registrarSaida } from "@/server/services/estoque";
import { devolverVenda, registrarVenda } from "@/server/services/vendas";
import { dadosInventario, emitirInventario, listarEmissoes, obterPdf } from "@/server/services/relatorios";
import { demonstrativoReposicao } from "@/server/services/reposicao";
import { vendaItens } from "@/server/db/schema";

const SET = { de: "2026-09-01", ate: "2026-09-30" };
let temPdftotext = true;
try { execFileSync("pdftotext", ["-v"], { stdio: "ignore" }); } catch { temPdftotext = false; }

describe("M9 · relatório de inventário e demonstrativo de reposição", () => {
  let c: Cenario;
  let floresca: number, distrib: number, oleo: number, mascara: number, refri: number;

  beforeAll(async () => {
    c = await novoCenario();
    const cosm = (await salvarCategoria(c.db, c.admin, { nome: "Cosméticos" })).id;
    const beb = (await salvarCategoria(c.db, c.admin, { nome: "Bebidas" })).id;
    floresca = (await salvarFornecedor(c.db, c.admin, { nome: "Floresça" })).id;
    distrib = (await salvarFornecedor(c.db, c.admin, { nome: "Distribuidora Ayo" })).id;
    oleo = (await criarProduto(c.db, c.admin, { nome: "Óleo", modalidade: "consignado", categoriaId: cosm, fornecedorId: floresca, precoVendaCents: 5000, repasseCents: 3000, comissaoBps: 1000 })).id;
    mascara = (await criarProduto(c.db, c.admin, { nome: "Máscara", modalidade: "proprio", categoriaId: cosm, fornecedorId: distrib, precoVendaCents: 6000, comissaoBps: 500 })).id;
    refri = (await criarProduto(c.db, c.admin, { nome: "Refrigerante", modalidade: "proprio", categoriaId: beb, precoVendaCents: 600 })).id;
    await registrarEntrada(c.db, c.admin, { produtoId: oleo, quantidade: 10, dataEfetiva: "2026-09-01" });
    await registrarEntrada(c.db, c.admin, { produtoId: mascara, quantidade: 10, custoUnitarioCents: 2000, dataEfetiva: "2026-09-01" });
    await registrarEntrada(c.db, c.admin, { produtoId: mascara, quantidade: 5, custoUnitarioCents: 2600, dataEfetiva: "2026-09-10" });
    await registrarEntrada(c.db, c.admin, { produtoId: refri, quantidade: 24, custoUnitarioCents: 280, dataEfetiva: "2026-09-01" });
    const { venda } = await registrarVenda(c.db, c.admin, {
      chaveIdempotencia: "reposicao-venda-1", colaboradorId: c.colab.id, dataEfetiva: "2026-09-15",
      itens: [{ produtoId: oleo, quantidade: 2 }, { produtoId: mascara, quantidade: 3 }, { produtoId: refri, quantidade: 5 }],
      pagamentos: [{ forma: "pix", valorCents: 31000 }],
    });
    await registrarSaida(c.db, c.admin, { produtoId: oleo, tipo: "consumo_interno", quantidade: 1, dataEfetiva: "2026-09-16" });
    await registrarSaida(c.db, c.admin, { produtoId: mascara, tipo: "perda", quantidade: 1, dataEfetiva: "2026-09-16" });
    const itens = await c.db.select().from(vendaItens).where(eq(vendaItens.vendaId, venda.id)).orderBy(vendaItens.id);
    await devolverVenda(c.db, c.admin, venda.id, { itens: [{ vendaItemId: itens[1].id, quantidade: 1 }], dataEfetiva: "2026-09-20", justificativa: "Troca" });
  });

  it("reposição por produto: guarda reposição a custo da última compra, repasse, comissões e consumo/perdas", async () => {
    const d = await demonstrativoReposicao(c.db, c.principal, SET, "produto");
    const linha = (nome: string) => d.linhas.find((l) => l.nome === nome)!;
    expect(linha("Óleo")).toMatchObject({ receitaCents: 10000, reporVendidosCents: 0, repasseFornecedoresCents: 6000, comissoesCents: 1000, reporConsumoPerdasCents: 3000, guardarCents: 10000, lucroCents: 0 });
    // 2 unidades líquidas × R$ 26,00 (última compra, não o custo médio de R$ 22,00) + perda de 1 × R$ 26,00
    expect(linha("Máscara")).toMatchObject({ receitaCents: 12000, reporVendidosCents: 5200, comissoesCents: 600, reporConsumoPerdasCents: 2600, guardarCents: 8400, lucroCents: 3600 });
    expect(linha("Refrigerante")).toMatchObject({ receitaCents: 3000, reporVendidosCents: 1400, guardarCents: 1400, lucroCents: 1600 });
    expect(d.total).toMatchObject({ receitaCents: 25000, guardarCents: 19800, lucroCents: 5200 });
  });

  it("reposição agrupada por fornecedor e por categoria fecha no mesmo total", async () => {
    const f = await demonstrativoReposicao(c.db, c.principal, SET, "fornecedor");
    expect(f.linhas.map((l) => [l.nome, l.receitaCents, l.guardarCents, l.lucroCents])).toEqual([
      ["Distribuidora Ayo", 12000, 8400, 3600],
      ["Floresça", 10000, 10000, 0],
      ["Sem fornecedor", 3000, 1400, 1600],
    ]);
    const cat = await demonstrativoReposicao(c.db, c.principal, SET, "categoria");
    expect(cat.linhas.map((l) => [l.nome, l.receitaCents, l.guardarCents, l.lucroCents])).toEqual([
      ["Cosméticos", 22000, 18400, 3600],
      ["Bebidas", 3000, 1400, 1600],
    ]);
    expect(f.total).toEqual({ ...cat.total });
  });

  it("demonstrativo é exclusivo do administrador principal", async () => {
    await expect(demonstrativoReposicao(c.db, c.admin, SET)).rejects.toThrow("administrador principal");
    await expect(demonstrativoReposicao(c.db, c.colab, SET)).rejects.toThrow();
  });

  it("inventário geral, por fornecedor e por produto", async () => {
    const g = await dadosInventario(c.db, c.admin);
    expect(g.linhas.map((l) => [l.nome, l.quantidade, l.valorCustoCents])).toEqual([
      ["Máscara", 12, 12 * 2200],
      ["Óleo", 7, 7 * 3000],
      ["Refrigerante", 19, 19 * 280],
    ]);
    expect(g.totais).toEqual({ produtos: 3, unidades: 38, proprioACustoCents: 26400 + 5320, consignadoARepasseCents: 21000, aPrecoDeVendaCents: 7 * 5000 + 12 * 6000 + 19 * 600 });
    const f = await dadosInventario(c.db, c.admin, { fornecedorId: floresca });
    expect(f.linhas.map((l) => l.nome)).toEqual(["Óleo"]);
    const p = await dadosInventario(c.db, c.admin, { produtoId: refri });
    expect(p.linhas.map((l) => l.nome)).toEqual(["Refrigerante"]);
    await expect(dadosInventario(c.db, c.colab)).rejects.toThrow("permissão");
  });

  it("PDF de inventário: nova versão só quando o estoque muda", async () => {
    const r1 = await emitirInventario(c.db, c.admin, { fornecedorId: distrib });
    expect(r1).toMatchObject({ nova: true, emissao: { versao: 1, retificado: false, filtro: `fornecedor:${distrib}` } });
    expect((await emitirInventario(c.db, c.admin, { fornecedorId: distrib })).nova).toBe(false);
    await registrarEntrada(c.db, c.admin, { produtoId: mascara, quantidade: 2, custoUnitarioCents: 2600 });
    const r3 = await emitirInventario(c.db, c.admin, { fornecedorId: distrib });
    expect(r3).toMatchObject({ nova: true, emissao: { versao: 2, retificado: false } });
    const lista = await listarEmissoes(c.db, c.admin);
    expect(lista.find((l) => l.id === r3.emissao.id)?.escopo).toBe("Fornecedor: Distribuidora Ayo");
    const { pdf, nome } = await obterPdf(c.db, c.admin, r3.emissao.id);
    expect(nome).toMatch(/^casafro-inventario-fornecedor-\d+-\d{4}-\d{2}-\d{2}-v2\.pdf$/);
    if (temPdftotext) {
      const arq = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "casafro-")), "i.pdf");
      fs.writeFileSync(arq, pdf);
      const txt = execFileSync("pdftotext", ["-layout", arq, "-"]).toString("utf8").replace(/ /g, " ");
      expect(txt).toContain("Relatório de inventário");
      expect(txt).toContain("Máscara");
      // 14 unidades a custo médio de R$ 22,57 ((12 × 22,00 + 2 × 26,00) ÷ 14) = R$ 315,98
      expect(txt).toMatch(/Máscara.*\b14\b.*R\$ 22,57.*R\$ 315,98/);
    }
  });
});
