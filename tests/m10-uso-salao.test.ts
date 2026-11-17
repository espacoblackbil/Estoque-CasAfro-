import { describe, it, expect, beforeAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import { novoCenario, type Cenario } from "./helpers";
import { criarProduto, editarProduto, salvarFornecedor } from "@/server/services/cadastros";
import { registrarEntrada, registrarUsoSalao, verificarConsistencia } from "@/server/services/estoque";
import { apurarResultado } from "@/server/services/financeiro";
import { extratoComissoes } from "@/server/services/comissoes";
import { movimentacoes, produtos, retiradasSalao } from "@/server/db/schema";
import { hoje } from "@/domain/datas";

describe("M10 · retirada de vários produtos para uso do salão", () => {
  let c: Cenario;
  let oleo: number, mascara: number;
  const prod = async (id: number) => (await c.db.select().from(produtos).where(eq(produtos.id, id)))[0];

  beforeAll(async () => {
    c = await novoCenario();
    const f = await salvarFornecedor(c.db, c.admin, { nome: "Floresça" });
    oleo = (await criarProduto(c.db, c.admin, { nome: "Óleo", modalidade: "consignado", fornecedorId: f.id, precoVendaCents: 5000, repasseCents: 3000, comissaoBps: 1000 })).id;
    mascara = (await criarProduto(c.db, c.admin, { nome: "Máscara", modalidade: "proprio", precoVendaCents: 6000, custoCents: 2000, comissaoBps: 500 })).id;
    await registrarEntrada(c.db, c.admin, { produtoId: oleo, quantidade: 10 });
    await registrarEntrada(c.db, c.admin, { produtoId: mascara, quantidade: 10 });
  });

  it("colaboradora retira vários produtos de uma vez: baixa estoque, gera repasse/custo, sem faturamento nem comissão", async () => {
    const r = await registrarUsoSalao(c.db, c.colab, {
      chaveIdempotencia: "retirada-teste-0001",
      itens: [{ produtoId: oleo, quantidade: 2 }, { produtoId: mascara, quantidade: 3 }],
      observacao: "Hidratação cliente Ana",
    });
    expect(r).toMatchObject({ duplicada: false, unidades: 5 });
    expect((await prod(oleo)).quantidade).toBe(8);
    expect((await prod(mascara)).quantidade).toBe(7);
    const movs = await c.db.select().from(movimentacoes).where(eq(movimentacoes.retiradaId, r.retirada.id)).orderBy(movimentacoes.id);
    expect(movs.map((m) => [m.tipo, m.quantidade, m.repasseTotalCents, m.custoTotalCents, m.usuarioId])).toEqual([
      ["consumo_interno", -2, 6000, 0, c.colab.id],
      ["consumo_interno", -3, 0, 6000, c.colab.id],
    ]);
    const res = await apurarResultado(c.db, c.admin, { de: hoje(), ate: hoje() });
    expect(res).toMatchObject({ receitaLiquidaCents: 0, comissoesCents: 0, consumoInternoCents: 12000, consumoInternoUnidades: 5, repasseDevidoTotalCents: 6000 });
    expect((await extratoComissoes(c.db, c.colab, c.colab.id)).geradoCents).toBe(0);
  });

  it("repetir o envio (inclusive em paralelo) não duplica a retirada", async () => {
    const dados = { chaveIdempotencia: "retirada-teste-0002", itens: [{ produtoId: mascara, quantidade: 1 }] };
    const [a, b] = await Promise.all([registrarUsoSalao(c.db, c.colab, dados), registrarUsoSalao(c.db, c.colab, dados)]);
    expect(a.retirada.id).toBe(b.retirada.id);
    expect((await registrarUsoSalao(c.db, c.colab, dados)).duplicada).toBe(true);
    const [{ n }] = await c.db.select({ n: sql<number>`count(*)::int` }).from(retiradasSalao).where(eq(retiradasSalao.chaveIdempotencia, dados.chaveIdempotencia));
    expect(n).toBe(1);
    expect((await prod(mascara)).quantidade).toBe(6);
  });

  it("regras: colaboradora não lança data passada; produto inativo, repetido ou fração são recusados; tudo ou nada", async () => {
    await expect(registrarUsoSalao(c.db, c.colab, { chaveIdempotencia: "retirada-teste-0003", dataEfetiva: "2026-09-10", itens: [{ produtoId: oleo, quantidade: 1 }] })).rejects.toThrow("administradores");
    await expect(registrarUsoSalao(c.db, c.colab, { chaveIdempotencia: "retirada-teste-0004", itens: [{ produtoId: oleo, quantidade: 1 }, { produtoId: oleo, quantidade: 1 }] })).rejects.toThrow("mais de uma vez");
    await expect(registrarUsoSalao(c.db, c.colab, { chaveIdempotencia: "retirada-teste-0005", itens: [{ produtoId: oleo, quantidade: 1.5 }] })).rejects.toThrow();
    await editarProduto(c.db, c.admin, mascara, { nome: "Máscara", modalidade: "proprio", precoVendaCents: 6000, custoCents: 2000, comissaoBps: 500, ativo: false });
    const antes = (await prod(oleo)).quantidade;
    await expect(registrarUsoSalao(c.db, c.colab, { chaveIdempotencia: "retirada-teste-0006", itens: [{ produtoId: oleo, quantidade: 1 }, { produtoId: mascara, quantidade: 1 }] })).rejects.toThrow("inativo");
    expect((await prod(oleo)).quantidade).toBe(antes); // nada foi baixado
    const adm = await registrarUsoSalao(c.db, c.admin, { chaveIdempotencia: "retirada-teste-0007", dataEfetiva: "2026-09-10", itens: [{ produtoId: oleo, quantidade: 1 }] });
    expect(adm.retirada.dataEfetiva).toBe("2026-09-10");
    expect(await verificarConsistencia(c.db)).toEqual([]);
    await expect(c.db.execute(sql`delete from retiradas_salao`)).rejects.toThrow();
  });
});
