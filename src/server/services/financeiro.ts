/**
 * Resultado financeiro da operação com produtos (spec §9, §10, §11.1).
 *
 * Fontes (todas com valores congelados no momento de cada transação):
 *  - venda_itens (pela data da venda): bruto, descontos, líquido, CMV, repasse, comissão;
 *  - venda_devolucoes (pela data da devolução): estornos desses mesmos valores;
 *  - movimentacoes ativas (pela data efetiva): consumo interno, perdas/danos, ajustes de custo.
 *
 * Resultado estimado = receita líquida − CMV próprio − repasses de vendidos − comissões
 *                      − consumo interno − perdas e danos.
 * Não é lucro líquido do salão: não inclui despesas gerais.
 */
import { and, asc, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import type { DB } from "../db";
import {
  categorias, comissaoLancamentos, comissaoPagamentos, fornecedores, movimentacoes, produtos, usuarios,
  vendaDevolucoes, vendaItens, vendaPagamentos, vendas,
} from "../db/schema";
import { hoje, intervaloDoMes, validarData } from "@/domain/datas";
import { ErroNegocio } from "../erros";
import { obterConfiguracoes } from "./configuracoes";
import { exigirAdmin, type Ator } from "./permissoes";

const int = (expr: ReturnType<typeof sql>) => sql<number>`coalesce(${expr}, 0)::int`;

export interface Periodo { de: string; ate: string }

export function validarPeriodo(p: Periodo): Periodo {
  validarData(p.de);
  validarData(p.ate);
  if (p.de > p.ate) throw new ErroNegocio("A data inicial deve ser anterior à final.");
  return p;
}

const naVenda = (p: Periodo) => and(gte(vendas.dataEfetiva, p.de), lte(vendas.dataEfetiva, p.ate));
const naDevolucao = (p: Periodo) => and(gte(vendaDevolucoes.dataEfetiva, p.de), lte(vendaDevolucoes.dataEfetiva, p.ate));
const noMov = (p: Periodo) => and(gte(movimentacoes.dataEfetiva, p.de), lte(movimentacoes.dataEfetiva, p.ate), eq(movimentacoes.anulada, false));

const ehConsumo = or(eq(movimentacoes.tipo, "consumo_interno"), and(eq(movimentacoes.tipo, "ajuste_inventario"), eq(movimentacoes.classificacao, "consumo_interno")));
const ehPerdaDano = or(
  inArray(movimentacoes.tipo, ["perda", "dano"]),
  and(eq(movimentacoes.tipo, "ajuste_inventario"), inArray(movimentacoes.classificacao, ["perda", "dano"])),
);

/** Indicadores agregados do período. */
export async function apurarResultado(db: DB, ator: Ator, periodo: Periodo) {
  exigirAdmin(ator);
  const p = validarPeriodo(periodo);

  const [v] = await db
    .select({
      vendas: sql<number>`count(distinct ${vendas.id})::int`,
      unidades: int(sql`sum(${vendaItens.quantidade})`),
      bruto: int(sql`sum(${vendaItens.brutoCents})`),
      descontos: int(sql`sum(${vendaItens.descontoItemCents} + ${vendaItens.descontoRateadoCents})`),
      liquido: int(sql`sum(${vendaItens.liquidoCents})`),
      cmv: int(sql`sum(${vendaItens.custoTotalCents})`),
      repasse: int(sql`sum(${vendaItens.repasseTotalCents})`),
      comissao: int(sql`sum(${vendaItens.comissaoCents})`),
    })
    .from(vendaItens)
    .innerJoin(vendas, eq(vendas.id, vendaItens.vendaId))
    .where(naVenda(p));

  const [d] = await db
    .select({
      unidades: int(sql`sum(${vendaDevolucoes.quantidade})`),
      bruto: int(sql`sum(${vendaDevolucoes.brutoCents})`),
      descontos: int(sql`sum(${vendaDevolucoes.descontoCents})`),
      liquido: int(sql`sum(${vendaDevolucoes.liquidoCents})`),
      custo: int(sql`sum(${vendaDevolucoes.custoCents})`),
      repasse: int(sql`sum(${vendaDevolucoes.repasseCents})`),
      comissao: int(sql`sum(${vendaDevolucoes.comissaoCents})`),
    })
    .from(vendaDevolucoes)
    .where(naDevolucao(p));

  const [m] = await db
    .select({
      consumo: int(sql`sum(case when ${ehConsumo} then ${movimentacoes.custoTotalCents} + ${movimentacoes.repasseTotalCents} end)`),
      consumoQtd: int(sql`sum(case when ${ehConsumo} then -${movimentacoes.quantidade} end)`),
      perdas: int(sql`sum(case when ${ehPerdaDano} then ${movimentacoes.custoTotalCents} + ${movimentacoes.repasseTotalCents} end)`),
      perdasQtd: int(sql`sum(case when ${ehPerdaDano} then -${movimentacoes.quantidade} end)`),
      ajusteCusto: int(sql`sum(${movimentacoes.ajusteCustoCents})`),
      repasseTotal: int(sql`sum(${movimentacoes.repasseTotalCents})`),
    })
    .from(movimentacoes)
    .where(noMov(p));

  const faturamentoBruto = v.bruto - d.bruto;
  const descontos = v.descontos - d.descontos;
  const receitaLiquida = v.liquido - d.liquido;
  const cmvProprio = v.cmv - d.custo + m.ajusteCusto;
  const repassesVendidos = v.repasse - d.repasse;
  const comissoes = v.comissao - d.comissao;
  const resultado = receitaLiquida - cmvProprio - repassesVendidos - comissoes - m.consumo - m.perdas;

  return {
    periodo: p,
    quantidadeVendas: v.vendas,
    unidadesVendidas: v.unidades - d.unidades,
    faturamentoBrutoCents: v.bruto,
    descontosCents: v.descontos,
    devolucoesCents: d.liquido,
    devolucoesUnidades: d.unidades,
    /** Bruto e descontos líquidos de devoluções (base da receita). */
    faturamentoBrutoLiquidoDevCents: faturamentoBruto,
    descontosLiquidoDevCents: descontos,
    receitaLiquidaCents: receitaLiquida,
    cmvProprioCents: cmvProprio,
    ajusteCustoEstoqueNegativoCents: m.ajusteCusto,
    repassesVendidosCents: repassesVendidos,
    comissoesCents: comissoes,
    consumoInternoCents: m.consumo,
    consumoInternoUnidades: m.consumoQtd,
    perdasDanosCents: m.perdas,
    perdasDanosUnidades: m.perdasQtd,
    resultadoEstimadoCents: resultado,
    /** Total devido a fornecedores no período (vendas + consumo + perdas − devoluções). */
    repasseDevidoTotalCents: m.repasseTotal,
  };
}

export async function pagamentosPorForma(db: DB, ator: Ator, periodo: Periodo) {
  exigirAdmin(ator);
  return db
    .select({ forma: vendaPagamentos.forma, valorCents: int(sql`sum(${vendaPagamentos.valorCents})`) })
    .from(vendaPagamentos)
    .innerJoin(vendas, eq(vendas.id, vendaPagamentos.vendaId))
    .where(naVenda(periodo))
    .groupBy(vendaPagamentos.forma)
    .orderBy(vendaPagamentos.forma);
}

/** Produtos mais vendidos (unidades líquidas de devoluções do período). */
export async function rankingProdutos(db: DB, ator: Ator, periodo: Periodo, limite = 10) {
  exigirAdmin(ator);
  const vendidos = await db
    .select({
      produtoId: vendaItens.produtoId,
      nome: produtos.nome,
      quantidade: int(sql`sum(${vendaItens.quantidade})`),
      liquidoCents: int(sql`sum(${vendaItens.liquidoCents})`),
    })
    .from(vendaItens)
    .innerJoin(vendas, eq(vendas.id, vendaItens.vendaId))
    .innerJoin(produtos, eq(produtos.id, vendaItens.produtoId))
    .where(naVenda(periodo))
    .groupBy(vendaItens.produtoId, produtos.nome);
  const devolvidos = await db
    .select({
      produtoId: vendaItens.produtoId,
      quantidade: int(sql`sum(${vendaDevolucoes.quantidade})`),
      liquidoCents: int(sql`sum(${vendaDevolucoes.liquidoCents})`),
    })
    .from(vendaDevolucoes)
    .innerJoin(vendaItens, eq(vendaItens.id, vendaDevolucoes.vendaItemId))
    .where(naDevolucao(periodo))
    .groupBy(vendaItens.produtoId);
  return vendidos
    .map((x) => {
      const dv = devolvidos.find((y) => y.produtoId === x.produtoId);
      return { ...x, quantidade: x.quantidade - (dv?.quantidade ?? 0), liquidoCents: x.liquidoCents - (dv?.liquidoCents ?? 0) };
    })
    .filter((x) => x.quantidade > 0)
    .sort((a, b) => b.quantidade - a.quantidade || b.liquidoCents - a.liquidoCents)
    .slice(0, limite);
}

/** Ranking de colaboradores por vendas líquidas (descontadas as devoluções do período). */
export async function rankingColaboradores(db: DB, ator: Ator, periodo: Periodo) {
  exigirAdmin(ator);
  const vendido = await db
    .select({
      colaboradorId: vendas.colaboradorId,
      nome: usuarios.nome,
      vendas: sql<number>`count(distinct ${vendas.id})::int`,
      liquidoCents: int(sql`sum(${vendaItens.liquidoCents})`),
      comissaoCents: int(sql`sum(${vendaItens.comissaoCents})`),
    })
    .from(vendas)
    .innerJoin(vendaItens, eq(vendaItens.vendaId, vendas.id))
    .innerJoin(usuarios, eq(usuarios.id, vendas.colaboradorId))
    .where(naVenda(periodo))
    .groupBy(vendas.colaboradorId, usuarios.nome);
  const devolvido = await db
    .select({
      colaboradorId: vendas.colaboradorId,
      liquidoCents: int(sql`sum(${vendaDevolucoes.liquidoCents})`),
      comissaoCents: int(sql`sum(${vendaDevolucoes.comissaoCents})`),
    })
    .from(vendaDevolucoes)
    .innerJoin(vendas, eq(vendas.id, vendaDevolucoes.vendaId))
    .where(naDevolucao(periodo))
    .groupBy(vendas.colaboradorId);
  return vendido
    .map((x) => {
      const dv = devolvido.find((y) => y.colaboradorId === x.colaboradorId);
      return { ...x, liquidoCents: x.liquidoCents - (dv?.liquidoCents ?? 0), comissaoCents: x.comissaoCents - (dv?.comissaoCents ?? 0) };
    })
    .sort((a, b) => b.liquidoCents - a.liquidoCents);
}

/** Entradas e saídas de estoque do período, por tipo (quantidades e valores). */
export async function movimentacaoPorTipo(db: DB, ator: Ator, periodo: Periodo) {
  exigirAdmin(ator);
  return db
    .select({
      tipo: movimentacoes.tipo,
      classificacao: movimentacoes.classificacao,
      unidades: int(sql`sum(abs(${movimentacoes.quantidade}))`),
      valorCustoCents: int(sql`sum(abs(${movimentacoes.quantidade}) * ${movimentacoes.custoUnitarioCents})`),
      repasseCents: int(sql`sum(${movimentacoes.repasseTotalCents})`),
    })
    .from(movimentacoes)
    .where(noMov(periodo))
    .groupBy(movimentacoes.tipo, movimentacoes.classificacao)
    .orderBy(movimentacoes.tipo);
}

/** Posição atual do estoque e seus valores. */
export async function valoresEstoque(db: DB, ator: Ator) {
  exigirAdmin(ator);
  const linhas = await db
    .select({
      id: produtos.id,
      nome: produtos.nome,
      modalidade: produtos.modalidade,
      quantidade: produtos.quantidade,
      custoMedioCents: produtos.custoMedioCents,
      repasseCents: produtos.repasseCents,
      precoVendaCents: produtos.precoVendaCents,
      categoria: categorias.nome,
      fornecedor: fornecedores.nome,
    })
    .from(produtos)
    .leftJoin(categorias, eq(categorias.id, produtos.categoriaId))
    .leftJoin(fornecedores, eq(fornecedores.id, produtos.fornecedorId))
    .where(eq(produtos.ativo, true))
    .orderBy(asc(produtos.nome));
  let custoProprio = 0;
  let consignadoRepasse = 0;
  let valorVenda = 0;
  for (const l of linhas) {
    const q = Math.max(l.quantidade, 0);
    if (l.modalidade === "proprio") custoProprio += q * l.custoMedioCents;
    else consignadoRepasse += q * l.repasseCents;
    valorVenda += q * l.precoVendaCents;
  }
  return {
    produtos: linhas,
    custoEstoqueProprioCents: custoProprio,
    valorConsignadoEmPoderCents: consignadoRepasse,
    valorEstoqueAPrecoDeVendaCents: valorVenda,
    unidadesNegativas: linhas.filter((l) => l.quantidade < 0).length,
  };
}

/** Repasse apurado por fornecedor, separado por origem (venda, consumo, perdas/danos). */
export async function repassesPorFornecedor(db: DB, ator: Ator, periodo: Periodo) {
  exigirAdmin(ator);
  const linhas = await db
    .select({
      fornecedorId: movimentacoes.fornecedorId,
      nome: fornecedores.nome,
      documento: fornecedores.documento,
      vendasCents: int(sql`sum(case when ${movimentacoes.tipo} in ('venda','devolucao_venda') then ${movimentacoes.repasseTotalCents} end)`),
      consumoCents: int(sql`sum(case when ${ehConsumo} then ${movimentacoes.repasseTotalCents} end)`),
      perdasCents: int(sql`sum(case when ${ehPerdaDano} then ${movimentacoes.repasseTotalCents} end)`),
      totalCents: int(sql`sum(${movimentacoes.repasseTotalCents})`),
    })
    .from(movimentacoes)
    .innerJoin(fornecedores, eq(fornecedores.id, movimentacoes.fornecedorId))
    .where(and(noMov(periodo), eq(movimentacoes.modalidade, "consignado")))
    .groupBy(movimentacoes.fornecedorId, fornecedores.nome, fornecedores.documento)
    .orderBy(asc(fornecedores.nome));
  return linhas.filter((l) => l.totalCents !== 0);
}

export async function totaisComissoesPeriodo(db: DB, ator: Ator, periodo: Periodo) {
  exigirAdmin(ator);
  const [l] = await db
    .select({
      gerada: int(sql`sum(case when ${comissaoLancamentos.tipo} = 'gerada' then ${comissaoLancamentos.valorCents} end)`),
      estornos: int(sql`sum(case when ${comissaoLancamentos.tipo} <> 'gerada' then ${comissaoLancamentos.valorCents} end)`),
    })
    .from(comissaoLancamentos)
    .where(and(gte(comissaoLancamentos.dataEfetiva, periodo.de), lte(comissaoLancamentos.dataEfetiva, periodo.ate)));
  const [pg] = await db
    .select({ pago: int(sql`sum(${comissaoPagamentos.valorCents})`) })
    .from(comissaoPagamentos)
    .where(and(gte(comissaoPagamentos.dataEfetiva, periodo.de), lte(comissaoPagamentos.dataEfetiva, periodo.ate)));
  const [la] = await db
    .select({ v: int(sql`sum(${comissaoLancamentos.valorCents})`) })
    .from(comissaoLancamentos)
    .where(lte(comissaoLancamentos.dataEfetiva, periodo.ate));
  const [pa] = await db
    .select({ v: int(sql`sum(${comissaoPagamentos.valorCents})`) })
    .from(comissaoPagamentos)
    .where(lte(comissaoPagamentos.dataEfetiva, periodo.ate));
  const saldo = { l: la.v, p: pa.v };
  return { geradasCents: l.gerada, estornosAjustesCents: l.estornos, pagasCents: pg.pago, pendenteFimPeriodoCents: saldo.l - saldo.p };
}

/** Painel inicial do administrador (spec §10). */
export async function dashboard(db: DB, ator: Ator) {
  exigirAdmin(ator);
  const dia = hoje();
  const [ini, fim] = intervaloDoMes(dia.slice(0, 7));
  const mes = { de: ini, ate: fim };
  const [rDia, rMes, cfg] = await Promise.all([apurarResultado(db, ator, { de: dia, ate: dia }), apurarResultado(db, ator, mes), obterConfiguracoes(db)]);
  const estoqueBaixo = await db
    .select({ id: produtos.id, nome: produtos.nome, quantidade: produtos.quantidade })
    .from(produtos)
    .where(and(eq(produtos.ativo, true), lte(produtos.quantidade, cfg.estoqueMinimo)))
    .orderBy(asc(produtos.quantidade), asc(produtos.nome));
  const ultimasVendas = await db
    .select({ id: vendas.id, liquidoCents: vendas.liquidoCents, colaborador: usuarios.nome, criadoEm: vendas.criadoEm, situacao: vendas.situacao })
    .from(vendas)
    .innerJoin(usuarios, eq(usuarios.id, vendas.colaboradorId))
    .orderBy(desc(vendas.id))
    .limit(5);
  return {
    hoje: dia,
    mes,
    faturamentoDia: { brutoCents: rDia.faturamentoBrutoLiquidoDevCents, liquidoCents: rDia.receitaLiquidaCents, vendas: rDia.quantidadeVendas },
    faturamentoMes: { brutoCents: rMes.faturamentoBrutoLiquidoDevCents, liquidoCents: rMes.receitaLiquidaCents, vendas: rMes.quantidadeVendas },
    resultadoMesCents: rMes.resultadoEstimadoCents,
    resultadoMes: rMes,
    estoqueMinimo: cfg.estoqueMinimo,
    estoqueBaixo,
    rankingProdutos: await rankingProdutos(db, ator, mes, 5),
    rankingColaboradores: await rankingColaboradores(db, ator, mes),
    ultimasVendas,
  };
}
