/**
 * Demonstrativo "Reposição e lucro" (somente o administrador principal).
 *
 * Para cada produto vendido, usado ou perdido no período, separa a receita em:
 *   - reposição dos próprios vendidos: unidades líquidas × custo da ÚLTIMA compra (repor hoje);
 *   - repasse a fornecedores: o devido pelos consignados vendidos;
 *   - comissões geradas;
 *   - reposição de consumo interno e perdas: próprios a custo da última compra, consignados pelo repasse;
 *   - lucro livre = receita líquida − tudo o que precisa ser guardado.
 * Agrupa por fornecedor, categoria ou produto.
 */
import { and, asc, desc, eq, gt, gte, inArray, lte, or } from "drizzle-orm";
import type { DB } from "../db";
import { categorias, fornecedores, movimentacoes, produtos, vendaDevolucoes, vendaItens, vendas } from "../db/schema";
import { validarPeriodo, type Periodo } from "./financeiro";
import { exigirPrincipal, type Ator } from "./permissoes";

export type Agrupamento = "fornecedor" | "categoria" | "produto";

export interface LinhaReposicao {
  chave: string;
  nome: string;
  receitaCents: number;
  reporVendidosCents: number;
  repasseFornecedoresCents: number;
  comissoesCents: number;
  reporConsumoPerdasCents: number;
  guardarCents: number;
  lucroCents: number;
}

type Acumulado = Omit<LinhaReposicao, "chave" | "nome" | "guardarCents" | "lucroCents">;
const zero = (): Acumulado => ({ receitaCents: 0, reporVendidosCents: 0, repasseFornecedoresCents: 0, comissoesCents: 0, reporConsumoPerdasCents: 0 });

/** Custo da última compra (entrada ou saldo inicial com custo) de cada produto próprio. */
async function ultimosCustos(db: DB, ids: number[]): Promise<Map<number, number>> {
  const mapa = new Map<number, number>();
  if (!ids.length) return mapa;
  const linhas = await db
    .selectDistinctOn([movimentacoes.produtoId], { produtoId: movimentacoes.produtoId, custo: movimentacoes.custoUnitarioCents })
    .from(movimentacoes)
    .where(and(
      inArray(movimentacoes.produtoId, ids),
      eq(movimentacoes.anulada, false),
      eq(movimentacoes.modalidade, "proprio"),
      inArray(movimentacoes.tipo, ["entrada", "saldo_inicial"]),
      gt(movimentacoes.custoUnitarioCents, 0),
    ))
    .orderBy(asc(movimentacoes.produtoId), desc(movimentacoes.dataEfetiva), desc(movimentacoes.id));
  for (const l of linhas) mapa.set(l.produtoId, l.custo);
  return mapa;
}

export async function demonstrativoReposicao(db: DB, ator: Ator, periodo: Periodo, agrupar: Agrupamento = "fornecedor") {
  exigirPrincipal(ator);
  const p = validarPeriodo(periodo);

  const vendidos = await db
    .select({
      produtoId: vendaItens.produtoId, modalidade: vendaItens.modalidade, quantidade: vendaItens.quantidade,
      liquido: vendaItens.liquidoCents, repasse: vendaItens.repasseTotalCents, comissao: vendaItens.comissaoCents, custoUnit: vendaItens.custoUnitarioCents,
    })
    .from(vendaItens)
    .innerJoin(vendas, eq(vendas.id, vendaItens.vendaId))
    .where(and(gte(vendas.dataEfetiva, p.de), lte(vendas.dataEfetiva, p.ate)));

  const devolvidos = await db
    .select({
      produtoId: vendaItens.produtoId, modalidade: vendaItens.modalidade, quantidade: vendaDevolucoes.quantidade,
      liquido: vendaDevolucoes.liquidoCents, repasse: vendaDevolucoes.repasseCents, comissao: vendaDevolucoes.comissaoCents,
    })
    .from(vendaDevolucoes)
    .innerJoin(vendaItens, eq(vendaItens.id, vendaDevolucoes.vendaItemId))
    .where(and(gte(vendaDevolucoes.dataEfetiva, p.de), lte(vendaDevolucoes.dataEfetiva, p.ate)));

  // consumo interno, perdas e danos (inclusive ajustes de inventário assim classificados)
  const baixas = await db
    .select({ produtoId: movimentacoes.produtoId, modalidade: movimentacoes.modalidade, quantidade: movimentacoes.quantidade, repasse: movimentacoes.repasseTotalCents, custoUnit: movimentacoes.custoUnitarioCents })
    .from(movimentacoes)
    .where(and(
      gte(movimentacoes.dataEfetiva, p.de),
      lte(movimentacoes.dataEfetiva, p.ate),
      eq(movimentacoes.anulada, false),
      or(
        inArray(movimentacoes.tipo, ["consumo_interno", "perda", "dano"]),
        and(eq(movimentacoes.tipo, "ajuste_inventario"), inArray(movimentacoes.classificacao, ["consumo_interno", "perda", "dano"])),
      ),
    ));

  const ids = [...new Set([...vendidos, ...devolvidos, ...baixas].map((x) => x.produtoId))];
  const ultimo = await ultimosCustos(db, ids);
  const info = ids.length
    ? await db
        .select({ id: produtos.id, nome: produtos.nome, custoMedio: produtos.custoMedioCents, categoria: categorias.nome, fornecedor: fornecedores.nome, fornecedorId: produtos.fornecedorId, categoriaId: produtos.categoriaId })
        .from(produtos)
        .leftJoin(categorias, eq(categorias.id, produtos.categoriaId))
        .leftJoin(fornecedores, eq(fornecedores.id, produtos.fornecedorId))
        .where(inArray(produtos.id, ids))
    : [];
  const prod = new Map(info.map((i) => [i.id, i]));
  /** Custo para repor uma unidade própria: última compra → custo médio atual → custo congelado na venda. */
  const custoRepor = (id: number, reserva: number) => ultimo.get(id) || prod.get(id)?.custoMedio || reserva;

  const porProduto = new Map<number, Acumulado>();
  const acc = (id: number) => {
    if (!porProduto.has(id)) porProduto.set(id, zero());
    return porProduto.get(id)!;
  };
  for (const v of vendidos) {
    const a = acc(v.produtoId);
    a.receitaCents += v.liquido;
    a.comissoesCents += v.comissao;
    if (v.modalidade === "proprio") a.reporVendidosCents += v.quantidade * custoRepor(v.produtoId, v.custoUnit);
    else a.repasseFornecedoresCents += v.repasse;
  }
  for (const d of devolvidos) {
    const a = acc(d.produtoId);
    a.receitaCents -= d.liquido;
    a.comissoesCents -= d.comissao;
    if (d.modalidade === "proprio") a.reporVendidosCents -= d.quantidade * custoRepor(d.produtoId, 0);
    else a.repasseFornecedoresCents -= d.repasse;
  }
  for (const b of baixas) {
    const a = acc(b.produtoId);
    const qtd = -b.quantidade;
    a.reporConsumoPerdasCents += b.modalidade === "proprio" ? qtd * custoRepor(b.produtoId, b.custoUnit) : b.repasse;
  }

  // agrupamento
  const grupos = new Map<string, { nome: string; a: Acumulado }>();
  for (const [id, a] of porProduto) {
    const i = prod.get(id);
    const [chave, nome] =
      agrupar === "produto" ? [`p${id}`, i?.nome ?? `Produto ${id}`]
      : agrupar === "categoria" ? [`c${i?.categoriaId ?? 0}`, i?.categoria ?? "Sem categoria"]
      : [`f${i?.fornecedorId ?? 0}`, i?.fornecedor ?? "Sem fornecedor"];
    const g = grupos.get(chave) ?? { nome, a: zero() };
    for (const k of Object.keys(g.a) as (keyof Acumulado)[]) g.a[k] += a[k];
    grupos.set(chave, g);
  }
  const fechar = (chave: string, nome: string, a: Acumulado): LinhaReposicao => {
    const guardarCents = a.reporVendidosCents + a.repasseFornecedoresCents + a.comissoesCents + a.reporConsumoPerdasCents;
    return { chave, nome, ...a, guardarCents, lucroCents: a.receitaCents - guardarCents };
  };
  const linhas = [...grupos.entries()]
    .map(([chave, g]) => fechar(chave, g.nome, g.a))
    .sort((x, y) => y.receitaCents - x.receitaCents || x.nome.localeCompare(y.nome, "pt-BR"));
  const total = zero();
  for (const l of linhas) for (const k of Object.keys(total) as (keyof Acumulado)[]) total[k] += l[k];
  return { periodo: p, agrupar, linhas, total: fechar("total", "Total", total) };
}
