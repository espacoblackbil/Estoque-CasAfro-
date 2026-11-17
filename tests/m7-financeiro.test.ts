import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { novoCenario, type Cenario } from "./helpers";
import { criarProduto, salvarFornecedor } from "@/server/services/cadastros";
import { registrarEntrada, registrarSaida } from "@/server/services/estoque";
import { devolverVenda, registrarVenda } from "@/server/services/vendas";
import {
  apurarResultado, dashboard, pagamentosPorForma, rankingColaboradores, rankingProdutos, repassesPorFornecedor, valoresEstoque,
} from "@/server/services/financeiro";
import { vendaItens } from "@/server/db/schema";
import { hoje } from "@/domain/datas";

const SET = { de: "2026-09-01", ate: "2026-09-30" };

describe("M7 · resultado financeiro e dashboard", () => {
  let c: Cenario;
  let oleo: number, mascara: number, fornId: number;

  beforeAll(async () => {
    c = await novoCenario();
    fornId = (await salvarFornecedor(c.db, c.admin, { nome: "Ayo Cosméticos" })).id;
    oleo = (await criarProduto(c.db, c.admin, { nome: "Óleo", modalidade: "consignado", fornecedorId: fornId, precoVendaCents: 5000, repasseCents: 3000, comissaoBps: 1000 })).id;
    mascara = (await criarProduto(c.db, c.admin, { nome: "Máscara", modalidade: "proprio", precoVendaCents: 6000, comissaoBps: 500 })).id;
    await registrarEntrada(c.db, c.admin, { produtoId: oleo, quantidade: 10, dataEfetiva: "2026-09-01" });
    await registrarEntrada(c.db, c.admin, { produtoId: mascara, quantidade: 10, custoUnitarioCents: 2000, dataEfetiva: "2026-09-01" });

    const { venda } = await registrarVenda(c.db, c.admin, {
      chaveIdempotencia: "setembro-venda-a", colaboradorId: c.colab.id, dataEfetiva: "2026-09-05",
      itens: [{ produtoId: oleo, quantidade: 2 }, { produtoId: mascara, quantidade: 1 }],
      descontoTotalCents: 1000,
      pagamentos: [{ forma: "pix", valorCents: 10000 }, { forma: "dinheiro", valorCents: 5000 }],
    });
    await registrarSaida(c.db, c.admin, { produtoId: oleo, tipo: "consumo_interno", quantidade: 1, dataEfetiva: "2026-09-10" });
    await registrarSaida(c.db, c.admin, { produtoId: mascara, tipo: "perda", quantidade: 1, dataEfetiva: "2026-09-12" });
    await registrarSaida(c.db, c.admin, { produtoId: oleo, tipo: "dano", quantidade: 1, dataEfetiva: "2026-09-12" });
    const [itOleo] = await c.db.select().from(vendaItens).where(eq(vendaItens.vendaId, venda.id)).orderBy(vendaItens.id);
    await devolverVenda(c.db, c.admin, venda.id, { itens: [{ vendaItemId: itOleo.id, quantidade: 1 }], dataEfetiva: "2026-09-20", justificativa: "Produto com defeito" });
    // fora do período
    await registrarVenda(c.db, c.admin, { chaveIdempotencia: "outubro-venda-b", colaboradorId: c.colab2.id, dataEfetiva: "2026-10-01", itens: [{ produtoId: mascara, quantidade: 1 }], pagamentos: [{ forma: "credito", valorCents: 6000 }] });
  });

  it("apura cada linha do resultado sem duplicar despesas", async () => {
    const r = await apurarResultado(c.db, c.admin, SET);
    expect(r).toMatchObject({
      quantidadeVendas: 1,
      faturamentoBrutoCents: 16000,
      descontosCents: 1000,
      devolucoesCents: 4688,
      receitaLiquidaCents: 10312,
      cmvProprioCents: 2000,
      repassesVendidosCents: 3000,
      comissoesCents: 750,
      consumoInternoCents: 3000,
      consumoInternoUnidades: 1,
      perdasDanosCents: 5000,
      perdasDanosUnidades: 2,
      resultadoEstimadoCents: 10312 - 2000 - 3000 - 750 - 3000 - 5000,
      repasseDevidoTotalCents: 9000,
    });
  });

  it("critério 3 — consumo interno de consignado gera repasse sem faturamento", async () => {
    const r = await apurarResultado(c.db, c.admin, { de: "2026-09-10", ate: "2026-09-10" });
    expect(r.receitaLiquidaCents).toBe(0);
    expect(r.faturamentoBrutoCents).toBe(0);
    expect(r.repasseDevidoTotalCents).toBe(3000);
    expect(r.consumoInternoCents).toBe(3000);
    expect(r.comissoesCents).toBe(0);
  });

  it("repasse por fornecedor separado por origem e coerente com o total", async () => {
    const [f] = await repassesPorFornecedor(c.db, c.admin, SET);
    expect(f).toMatchObject({ fornecedorId: fornId, vendasCents: 3000, consumoCents: 3000, perdasCents: 3000, totalCents: 9000 });
  });

  it("rankings, pagamentos e estoque", async () => {
    const rp = await rankingProdutos(c.db, c.admin, SET);
    expect(rp.map((x) => [x.nome, x.quantidade])).toEqual([["Máscara", 1], ["Óleo", 1]]);
    const rc = await rankingColaboradores(c.db, c.admin, SET);
    expect(rc).toHaveLength(1);
    expect(rc[0]).toMatchObject({ colaboradorId: c.colab.id, liquidoCents: 10312 });
    const pg = await pagamentosPorForma(c.db, c.admin, SET);
    expect(pg).toEqual([{ forma: "pix", valorCents: 10000 }, { forma: "dinheiro", valorCents: 5000 }]);
    const est = await valoresEstoque(c.db, c.admin);
    // máscara: 10 − 1 venda − 1 perda − 1 venda out = 7 × 2000; óleo: 10 − 2 − 1 − 1 + 1 = 7 × 3000
    expect(est.custoEstoqueProprioCents).toBe(14000);
    expect(est.valorConsignadoEmPoderCents).toBe(21000);
  });

  it("dashboard só para admins e reflete os dados reais", async () => {
    await expect(dashboard(c.db, c.colab)).rejects.toThrow("permissão");
    await expect(apurarResultado(c.db, c.colab, SET)).rejects.toThrow("permissão");
    await registrarVenda(c.db, c.colab, { chaveIdempotencia: "venda-de-hoje-1", colaboradorId: c.colab.id, itens: [{ produtoId: mascara, quantidade: 1 }], pagamentos: [{ forma: "pix", valorCents: 6000 }] });
    const d = await dashboard(c.db, c.admin);
    expect(d.hoje).toBe(hoje());
    expect(d.faturamentoDia).toMatchObject({ liquidoCents: 6000, vendas: 1 });
    expect(d.faturamentoMes.liquidoCents).toBeGreaterThanOrEqual(6000);
    expect(d.rankingColaboradores[0].colaboradorId).toBe(c.colab.id);
  });
});
