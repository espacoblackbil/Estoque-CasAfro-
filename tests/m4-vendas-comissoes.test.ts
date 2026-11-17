import { describe, it, expect, beforeAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import { novoCenario, type Cenario } from "./helpers";
import { criarProduto, editarProduto, salvarFornecedor } from "@/server/services/cadastros";
import { registrarEntrada, verificarConsistencia } from "@/server/services/estoque";
import { cancelarVenda, devolverVenda, ErroMargemNegativa, listarVendas, obterVenda, registrarVenda } from "@/server/services/vendas";
import { extratoComissoes, registrarPagamentoComissao, resumoComissoes } from "@/server/services/comissoes";
import { comissaoLancamentos, comissaoPagamentos, movimentacoes, produtos, vendaItens, vendas } from "@/server/db/schema";

let seq = 0;
const chave = () => `teste-${Date.now()}-${++seq}`;

describe("M4–M6 · vendas, devoluções e comissões", () => {
  let c: Cenario;
  let oleo: number, mascara: number, refri: number;
  const prod = async (id: number) => (await c.db.select().from(produtos).where(eq(produtos.id, id)))[0];

  beforeAll(async () => {
    c = await novoCenario();
    const f = await salvarFornecedor(c.db, c.admin, { nome: "Ayo Cosméticos", documento: "529.982.247-25" });
    oleo = (await criarProduto(c.db, c.admin, { nome: "Óleo Consignado", modalidade: "consignado", fornecedorId: f.id, precoVendaCents: 5000, repasseCents: 3000, comissaoBps: 1000 })).id;
    mascara = (await criarProduto(c.db, c.admin, { nome: "Máscara Própria", modalidade: "proprio", precoVendaCents: 6000, comissaoBps: 500 })).id;
    refri = (await criarProduto(c.db, c.admin, { nome: "Refrigerante", modalidade: "proprio", precoVendaCents: 600 })).id;
    await registrarEntrada(c.db, c.admin, { produtoId: oleo, quantidade: 20 });
    await registrarEntrada(c.db, c.admin, { produtoId: mascara, quantidade: 10, custoUnitarioCents: 2000 });
    await registrarEntrada(c.db, c.admin, { produtoId: refri, quantidade: 24, custoUnitarioCents: 280 });
  });

  it("critério 1 — venda com vários produtos e pagamento dividido", async () => {
    const base = {
      chaveIdempotencia: chave(),
      colaboradorId: c.colab.id,
      cliente: "Maria",
      itens: [{ produtoId: oleo, quantidade: 2 }, { produtoId: mascara, quantidade: 1 }, { produtoId: refri, quantidade: 3 }],
    };
    await expect(registrarVenda(c.db, c.colab, { ...base, pagamentos: [{ forma: "pix", valorCents: 10000 }] })).rejects.toThrow("soma dos pagamentos");
    const { venda } = await registrarVenda(c.db, c.colab, { ...base, pagamentos: [{ forma: "pix", valorCents: 10000 }, { forma: "dinheiro", valorCents: 5000 }, { forma: "credito", valorCents: 2800 }] });
    expect(venda).toMatchObject({ brutoCents: 17800, liquidoCents: 17800, situacao: "ativa", estoqueNegativo: false });
    const itens = await c.db.select().from(vendaItens).where(eq(vendaItens.vendaId, venda.id)).orderBy(vendaItens.id);
    expect(itens.map((i) => [i.liquidoCents, i.comissaoCents, i.repasseTotalCents, i.custoTotalCents])).toEqual([
      [10000, 1000, 6000, 0],
      [6000, 300, 0, 2000],
      [1800, 0, 0, 840],
    ]);
    expect((await prod(oleo)).quantidade).toBe(18);
    expect((await prod(refri)).quantidade).toBe(21);
    const ext = await extratoComissoes(c.db, c.colab, c.colab.id);
    expect(ext.geradoCents).toBe(1300);
  });

  it("idempotência — repetir a operação (inclusive em paralelo) não duplica a venda", async () => {
    const dados = { chaveIdempotencia: chave(), colaboradorId: c.colab.id, itens: [{ produtoId: refri, quantidade: 1 }], pagamentos: [{ forma: "pix" as const, valorCents: 600 }] };
    const [a, b] = await Promise.all([registrarVenda(c.db, c.colab, dados), registrarVenda(c.db, c.colab, dados)]);
    expect(a.venda.id).toBe(b.venda.id);
    const r3 = await registrarVenda(c.db, c.colab, dados);
    expect(r3.duplicada).toBe(true);
    const [{ n }] = await c.db.select({ n: sql<number>`count(*)::int` }).from(vendas).where(eq(vendas.chaveIdempotencia, dados.chaveIdempotencia));
    expect(n).toBe(1);
    expect((await prod(refri)).quantidade).toBe(20);
  });

  it("critério 2 — descontos (só admin) rateados; comissão sobre o líquido; repasse intacto", async () => {
    const dados = {
      chaveIdempotencia: chave(),
      colaboradorId: c.colab.id,
      itens: [{ produtoId: oleo, quantidade: 1 }, { produtoId: mascara, quantidade: 1, descontoCents: 500 }],
      descontoTotalCents: 1000,
      pagamentos: [{ forma: "debito" as const, valorCents: 9500 }],
    };
    await expect(registrarVenda(c.db, c.colab, dados)).rejects.toThrow("administradores podem aplicar descontos");
    const { venda } = await registrarVenda(c.db, c.admin, dados);
    expect(venda).toMatchObject({ brutoCents: 11000, descontoItensCents: 500, descontoTotalCents: 1000, liquidoCents: 9500 });
    const itens = await c.db.select().from(vendaItens).where(eq(vendaItens.vendaId, venda.id)).orderBy(vendaItens.id);
    // base 5000 e 5500 → rateio de 1000: 476 e 524 (maiores restos)
    expect(itens.map((i) => [i.descontoRateadoCents, i.liquidoCents, i.comissaoCents, i.repasseTotalCents])).toEqual([
      [476, 4524, 452, 3000],
      [524, 4976, 249, 0],
    ]);
    expect(itens.reduce((a, i) => a + i.liquidoCents, 0)).toBe(venda.liquidoCents);
  });

  it("colaborador não vende em nome de outro nem lança retroativo", async () => {
    const d = { chaveIdempotencia: chave(), colaboradorId: c.colab2.id, itens: [{ produtoId: refri, quantidade: 1 }], pagamentos: [{ forma: "pix" as const, valorCents: 600 }] };
    await expect(registrarVenda(c.db, c.colab, d)).rejects.toThrow("próprio nome");
    await expect(registrarVenda(c.db, c.colab, { ...d, colaboradorId: c.colab.id, dataEfetiva: "2026-01-10" })).rejects.toThrow("retroativas");
  });

  it("margem negativa exige autorização de administrador", async () => {
    const promo = (await criarProduto(c.db, c.admin, { nome: "Bala Promo", modalidade: "proprio", precoVendaCents: 100 })).id;
    await registrarEntrada(c.db, c.admin, { produtoId: promo, quantidade: 50, custoUnitarioCents: 150 });
    const d = () => ({ chaveIdempotencia: chave(), colaboradorId: c.colab.id, itens: [{ produtoId: promo, quantidade: 2 }], pagamentos: [{ forma: "dinheiro" as const, valorCents: 200 }] });
    await expect(registrarVenda(c.db, c.colab, d())).rejects.toBeInstanceOf(ErroMargemNegativa);
    await expect(registrarVenda(c.db, c.colab, { ...d(), autorizacao: { login: "bia", senha: "senha123" } })).rejects.toThrow("Autorização");
    await expect(registrarVenda(c.db, c.colab, { ...d(), autorizacao: { login: "admin", senha: "errada" } })).rejects.toThrow("Autorização");
    const ok = await registrarVenda(c.db, c.colab, { ...d(), autorizacao: { login: "admin", senha: "senha123" } });
    expect(ok.venda).toMatchObject({ margemNegativa: true, autorizadoPor: c.admin.id });
    await expect(registrarVenda(c.db, c.admin, d())).rejects.toBeInstanceOf(ErroMargemNegativa);
    const ok2 = await registrarVenda(c.db, c.admin, { ...d(), autorizarMargemNegativa: true });
    expect(ok2.venda.autorizadoPor).toBe(c.admin.id);
    // nenhuma das tentativas recusadas deixou rastro no estoque
    expect((await prod(promo)).quantidade).toBe(46);
  });

  it("critério 5 — vende com estoque negativo e regulariza depois", async () => {
    const p = (await criarProduto(c.db, c.admin, { nome: "Finalizador", modalidade: "proprio", precoVendaCents: 4000, comissaoBps: 1000 })).id;
    await registrarEntrada(c.db, c.admin, { produtoId: p, quantidade: 1, custoUnitarioCents: 1500 });
    const { venda } = await registrarVenda(c.db, c.colab, { chaveIdempotencia: chave(), colaboradorId: c.colab.id, itens: [{ produtoId: p, quantidade: 3 }], pagamentos: [{ forma: "pix", valorCents: 12000 }] });
    expect(venda.estoqueNegativo).toBe(true);
    const [item] = await c.db.select().from(vendaItens).where(eq(vendaItens.vendaId, venda.id));
    expect(item).toMatchObject({ qtdSemSaldo: 2, custoTotalCents: 4500 });
    expect(await prod(p)).toMatchObject({ quantidade: -2, pendenteQtd: 2, pendenteCustoCents: 3000 });
    const e = await registrarEntrada(c.db, c.admin, { produtoId: p, quantidade: 6, custoUnitarioCents: 1800 });
    expect(e.ajusteCustoCents).toBe(600); // 2 × (1800 − 1500)
    expect(await prod(p)).toMatchObject({ quantidade: 4, pendenteQtd: 0, custoMedioCents: 1800 });
  });

  it("critério 6 — cancelar venda com comissão já paga gera ajuste negativo, sem tocar no pagamento", async () => {
    const { venda } = await registrarVenda(c.db, c.colab2, { chaveIdempotencia: chave(), colaboradorId: c.colab2.id, itens: [{ produtoId: oleo, quantidade: 2 }], pagamentos: [{ forma: "pix", valorCents: 10000 }] });
    expect((await extratoComissoes(c.db, c.admin, c.colab2.id)).saldoPendenteCents).toBe(1000);
    await expect(registrarPagamentoComissao(c.db, c.admin, { colaboradorId: c.colab2.id, valorCents: 1001 })).rejects.toThrow("maior que o saldo");
    await expect(registrarPagamentoComissao(c.db, c.colab2, { colaboradorId: c.colab2.id, valorCents: 100 })).rejects.toThrow("permissão");
    const pag = await registrarPagamentoComissao(c.db, c.admin, { colaboradorId: c.colab2.id, valorCents: 1000, observacao: "Pix" });
    const estoqueAntes = (await prod(oleo)).quantidade;

    await expect(cancelarVenda(c.db, c.colab2, venda.id, "cliente desistiu")).rejects.toThrow("permissão");
    await cancelarVenda(c.db, c.admin, venda.id, "Cliente desistiu da compra");
    const ext = await extratoComissoes(c.db, c.colab2, c.colab2.id);
    expect(ext).toMatchObject({ geradoCents: 1000, estornosCents: 0, ajustesNegativosCents: -1000, pagoCents: 1000, saldoPendenteCents: -1000 });
    const [p] = await c.db.select().from(comissaoPagamentos).where(eq(comissaoPagamentos.id, pag.id));
    expect(p.valorCents).toBe(1000); // pagamento preservado
    expect((await prod(oleo)).quantidade).toBe(estoqueAntes + 2);
    // repasse estornado na devolução
    const movs = await c.db.select().from(movimentacoes).where(eq(movimentacoes.tipo, "devolucao_venda"));
    expect(movs.at(-1)).toMatchObject({ quantidade: 2, repasseTotalCents: -6000 });
    await expect(cancelarVenda(c.db, c.admin, venda.id, "de novo")).rejects.toThrow("já foi cancelada");

    // compensação em comissões futuras
    await registrarVenda(c.db, c.colab2, { chaveIdempotencia: chave(), colaboradorId: c.colab2.id, itens: [{ produtoId: oleo, quantidade: 1 }], pagamentos: [{ forma: "pix", valorCents: 5000 }] });
    expect((await extratoComissoes(c.db, c.colab2, c.colab2.id)).saldoPendenteCents).toBe(-500);
  });

  it("estorno parcialmente pago: parte estorno, parte ajuste negativo", async () => {
    const colab3 = c.principal; // principal também pode ser responsável por vendas
    const { venda } = await registrarVenda(c.db, c.admin, { chaveIdempotencia: chave(), colaboradorId: colab3.id, itens: [{ produtoId: oleo, quantidade: 2 }], pagamentos: [{ forma: "pix", valorCents: 10000 }] });
    await registrarPagamentoComissao(c.db, c.admin, { colaboradorId: colab3.id, valorCents: 400 });
    await cancelarVenda(c.db, c.admin, venda.id, "Erro de lançamento");
    const l = await c.db.select().from(comissaoLancamentos).where(eq(comissaoLancamentos.vendaId, venda.id)).orderBy(comissaoLancamentos.id);
    expect(l.map((x) => [x.tipo, x.valorCents])).toEqual([["gerada", 1000], ["estorno", -600], ["ajuste_negativo", -400]]);
  });

  it("devolução parcial fecha exatamente nos totais do item", async () => {
    const { venda } = await registrarVenda(c.db, c.admin, {
      chaveIdempotencia: chave(), colaboradorId: c.colab.id,
      itens: [{ produtoId: mascara, quantidade: 3 }], descontoTotalCents: 1001,
      pagamentos: [{ forma: "credito", valorCents: 16999 }],
    });
    const [item] = await c.db.select().from(vendaItens).where(eq(vendaItens.vendaId, venda.id));
    const r1 = await devolverVenda(c.db, c.admin, venda.id, { itens: [{ vendaItemId: item.id, quantidade: 1 }], justificativa: "Troca" });
    expect(r1.situacao).toBe("devolvida_parcial");
    await expect(devolverVenda(c.db, c.admin, venda.id, { itens: [{ vendaItemId: item.id, quantidade: 3 }], justificativa: "x" + "yz" })).rejects.toThrow("maior que a vendida");
    const r2 = await devolverVenda(c.db, c.admin, venda.id, { itens: [{ vendaItemId: item.id, quantidade: 2 }], justificativa: "Troca" });
    expect(r2.situacao).toBe("cancelada");
    const soma = (k: "liquidoCents" | "custoCents" | "comissaoCents") => r1.devolucoes[0][k] + r2.devolucoes[0][k];
    expect(soma("liquidoCents")).toBe(item.liquidoCents);
    expect(soma("custoCents")).toBe(item.custoTotalCents);
    expect(soma("comissaoCents")).toBe(item.comissaoCents);
  });

  it("critério 7 — venda retroativa preserva valores da época mesmo após mudança de preço", async () => {
    const { venda } = await registrarVenda(c.db, c.admin, {
      chaveIdempotencia: chave(), colaboradorId: c.colab.id, dataEfetiva: "2026-08-15",
      itens: [{ produtoId: oleo, quantidade: 1, precoUnitarioCents: 4500, repasseUnitarioCents: 2800, comissaoBps: 800 }],
      pagamentos: [{ forma: "dinheiro", valorCents: 4500 }],
    });
    await editarProduto(c.db, c.admin, oleo, { nome: "Óleo Consignado", modalidade: "consignado", fornecedorId: (await prod(oleo)).fornecedorId, precoVendaCents: 5500, repasseCents: 3300, comissaoBps: 1200 });
    const v = await obterVenda(c.db, c.admin, venda.id);
    expect(v.dataEfetiva).toBe("2026-08-15");
    expect(v.itens[0]).toMatchObject({ precoUnitarioCents: 4500, repasseUnitarioCents: 2800, comissaoBps: 800, comissaoCents: 360 });
    const [mov] = await c.db.select().from(movimentacoes).where(eq(movimentacoes.vendaItemId, v.itens[0].id));
    expect(mov).toMatchObject({ dataEfetiva: "2026-08-15", repasseUnitarioCents: 2800, repasseTotalCents: 2800 });
  });

  it("critério 9 — colaborador não acessa dados financeiros restritos", async () => {
    const minhas = await listarVendas(c.db, c.colab);
    expect(minhas.length).toBeGreaterThan(0);
    expect(minhas.every((v) => v.colaboradorId === c.colab.id)).toBe(true);
    const det = await obterVenda(c.db, c.colab, minhas[0].id);
    const json = JSON.stringify(det);
    for (const proibido of ["custo", "repasse", "margem", "comissaoBps", "qtdSemSaldo", "modalidade"]) expect(json).not.toContain(proibido);
    const deOutra = (await listarVendas(c.db, c.admin, { colaboradorId: c.colab2.id }))[0];
    await expect(obterVenda(c.db, c.colab, deOutra.id)).rejects.toThrow("permissão");
    await expect(extratoComissoes(c.db, c.colab, c.colab2.id)).rejects.toThrow("permissão");
    await expect(resumoComissoes(c.db, c.colab)).rejects.toThrow("permissão");
  });

  it("vendas e itens não podem ser apagados nem adulterados; saldos consistentes", async () => {
    await expect(c.db.execute(sql`delete from vendas`)).rejects.toThrow();
    await expect(c.db.execute(sql`update venda_itens set liquido_cents = 1`)).rejects.toThrow();
    await expect(c.db.execute(sql`update comissao_pagamentos set valor_cents = 1`)).rejects.toThrow();
    expect(await verificarConsistencia(c.db)).toEqual([]);
  });
});
