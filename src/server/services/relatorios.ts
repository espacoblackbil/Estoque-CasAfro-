/**
 * Relatórios em PDF, versões e retificações (spec §11, §12).
 *
 * Cada emissão grava: os dados numéricos usados (JSON), o hash desses dados, o PDF gerado,
 * quem emitiu e quando. Reemitir o mesmo relatório:
 *   - sem mudança nos dados → devolve a versão já existente (nenhuma versão nova);
 *   - com mudança (ex.: correção retroativa) → nova versão marcada como RETIFICADA,
 *     com a lista de alterações; as versões anteriores permanecem arquivadas e imutáveis.
 * A "posição atual do estoque" do relatório geral é um retrato do momento da emissão e,
 * por isso, não entra no hash (não gera retificação sozinha).
 */
import { createHash } from "node:crypto";
import { and, asc, desc, eq, gt, gte, lte, ne, sql } from "drizzle-orm";
import type { DB } from "../db";
import {
  auditoria, fornecedores, movimentacoes, produtos, relatorioEmissoes, usuarios,
  vendaDevolucoes, vendaItens, vendas,
} from "../db/schema";
import { ErroNegocio } from "../erros";
import { formatarBRL, formatarPercentual } from "@/domain/money";
import { formatarData, formatarDataHora } from "@/domain/datas";
import { renderizarPdf, type Bloco, type ModeloDocumento } from "../pdf/documento";
import { obterConfiguracoes } from "./configuracoes";
import { extratoComissoes, resumoComissoes } from "./comissoes";
import {
  apurarResultado, movimentacaoPorTipo, pagamentosPorForma, rankingColaboradores, rankingProdutos, repassesPorFornecedor,
  totaisComissoesPeriodo, validarPeriodo, valoresEstoque, type Periodo,
} from "./financeiro";
import { exigirAdmin, type Ator } from "./permissoes";

export type TipoRelatorio = "geral" | "fornecedor" | "colaborador" | "comissoes";

const R = formatarBRL;
const ROTULO_TIPO: Record<string, string> = {
  saldo_inicial: "Saldo inicial",
  entrada: "Entrada",
  venda: "Venda",
  consumo_interno: "Consumo interno",
  perda: "Perda",
  dano: "Dano",
  devolucao_fornecedor: "Devolução ao fornecedor",
  ajuste_inventario: "Ajuste de inventário",
  devolucao_venda: "Devolução de venda",
};
const ROTULO_CLASSIF: Record<string, string> = {
  perda: "perda",
  dano: "dano",
  consumo_interno: "consumo interno",
  devolucao_fornecedor: "devolução ao fornecedor",
  erro_registro: "erro de registro",
};
const ROTULO_FORMA: Record<string, string> = { pix: "Pix", dinheiro: "Dinheiro", debito: "Débito", credito: "Crédito" };

export function rotuloMovimento(tipo: string, classificacao?: string | null) {
  const base = ROTULO_TIPO[tipo] ?? tipo;
  return classificacao ? `${base} (${ROTULO_CLASSIF[classificacao] ?? classificacao})` : base;
}

// ───────────────────────────── Dados ─────────────────────────────

export async function dadosGeral(db: DB, ator: Ator, p: Periodo) {
  const resultado = await apurarResultado(db, ator, p);
  const estoque = await valoresEstoque(db, ator);
  const movs = await movimentacaoPorTipo(db, ator, p);
  const entradas = movs.filter((m) => m.tipo === "entrada");
  return {
    totais: {
      faturamentoBrutoCents: resultado.faturamentoBrutoCents,
      descontosCents: resultado.descontosCents,
      devolucoesCents: resultado.devolucoesCents,
      receitaLiquidaCents: resultado.receitaLiquidaCents,
      cmvProprioCents: resultado.cmvProprioCents,
      repassesVendidosCents: resultado.repassesVendidosCents,
      comissoesCents: resultado.comissoesCents,
      consumoInternoCents: resultado.consumoInternoCents,
      perdasDanosCents: resultado.perdasDanosCents,
      resultadoEstimadoCents: resultado.resultadoEstimadoCents,
      repasseDevidoTotalCents: resultado.repasseDevidoTotalCents,
      quantidadeVendas: resultado.quantidadeVendas,
      unidadesVendidas: resultado.unidadesVendidas,
      entradasUnidades: entradas.reduce((a, m) => a + m.unidades, 0),
      entradasValorCents: entradas.reduce((a, m) => a + m.valorCustoCents, 0),
    },
    resultado,
    pagamentos: await pagamentosPorForma(db, ator, p),
    movimentacoes: movs,
    rankingProdutos: await rankingProdutos(db, ator, p, 15),
    rankingColaboradores: await rankingColaboradores(db, ator, p),
    comissoes: await totaisComissoesPeriodo(db, ator, p),
    fornecedores: await repassesPorFornecedor(db, ator, p),
    posicaoEstoque: {
      custoEstoqueProprioCents: estoque.custoEstoqueProprioCents,
      valorConsignadoEmPoderCents: estoque.valorConsignadoEmPoderCents,
      valorEstoqueAPrecoDeVendaCents: estoque.valorEstoqueAPrecoDeVendaCents,
      produtosComSaldoNegativo: estoque.unidadesNegativas,
    },
  };
}

export async function dadosFornecedor(db: DB, ator: Ator, fornecedorId: number, p: Periodo) {
  exigirAdmin(ator);
  const [f] = await db.select().from(fornecedores).where(eq(fornecedores.id, fornecedorId));
  if (!f) throw new ErroNegocio("Fornecedor não encontrado.");
  // Somente movimentações que geraram (ou estornaram) obrigação de repasse.
  const linhas = await db
    .select({
      id: movimentacoes.id,
      data: movimentacoes.dataEfetiva,
      produtoId: movimentacoes.produtoId,
      produto: produtos.nome,
      tipo: movimentacoes.tipo,
      classificacao: movimentacoes.classificacao,
      quantidade: sql<number>`(-${movimentacoes.quantidade})::int`,
      repasseUnitarioCents: movimentacoes.repasseUnitarioCents,
      totalCents: movimentacoes.repasseTotalCents,
    })
    .from(movimentacoes)
    .innerJoin(produtos, eq(produtos.id, movimentacoes.produtoId))
    .where(and(
      eq(movimentacoes.fornecedorId, fornecedorId),
      eq(movimentacoes.modalidade, "consignado"),
      eq(movimentacoes.anulada, false),
      ne(movimentacoes.repasseTotalCents, 0),
      gte(movimentacoes.dataEfetiva, p.de),
      lte(movimentacoes.dataEfetiva, p.ate),
    ))
    .orderBy(asc(movimentacoes.dataEfetiva), asc(movimentacoes.id));

  const origem = (t: string, c: string | null) =>
    t === "venda" || t === "devolucao_venda" ? "vendas" : t === "consumo_interno" || c === "consumo_interno" ? "consumo" : "perdas";
  const porOrigem = { vendas: 0, consumo: 0, perdas: 0 };
  const mapa = new Map<string, { produto: string; quantidade: number; totalCents: number }>();
  for (const l of linhas) {
    porOrigem[origem(l.tipo, l.classificacao)] += l.totalCents;
    const k = `${l.produtoId}`;
    const atual = mapa.get(k) ?? { produto: l.produto, quantidade: 0, totalCents: 0 };
    atual.quantidade += l.quantidade;
    atual.totalCents += l.totalCents;
    mapa.set(k, atual);
  }
  const totalCents = linhas.reduce((a, l) => a + l.totalCents, 0);
  return {
    fornecedor: { id: f.id, nome: f.nome, documento: f.documento, telefone: f.telefone },
    totais: { totalCents, vendasCents: porOrigem.vendas, consumoCents: porOrigem.consumo, perdasDanosCents: porOrigem.perdas, movimentacoes: linhas.length },
    linhas: linhas.map((l) => ({ ...l, origem: rotuloMovimento(l.tipo, l.classificacao) })),
    porProduto: [...mapa.values()].sort((a, b) => a.produto.localeCompare(b.produto, "pt-BR")),
  };
}

export async function dadosColaborador(db: DB, ator: Ator, colaboradorId: number, p: Periodo) {
  exigirAdmin(ator);
  const [u] = await db.select({ id: usuarios.id, nome: usuarios.nome, login: usuarios.login }).from(usuarios).where(eq(usuarios.id, colaboradorId));
  if (!u) throw new ErroNegocio("Colaborador não encontrado.");
  const vendido = await db
    .select({
      produtoId: vendaItens.produtoId,
      produto: produtos.nome,
      quantidade: sql<number>`sum(${vendaItens.quantidade})::int`,
      liquidoCents: sql<number>`sum(${vendaItens.liquidoCents})::int`,
      comissaoCents: sql<number>`sum(${vendaItens.comissaoCents})::int`,
    })
    .from(vendaItens)
    .innerJoin(vendas, eq(vendas.id, vendaItens.vendaId))
    .innerJoin(produtos, eq(produtos.id, vendaItens.produtoId))
    .where(and(eq(vendas.colaboradorId, colaboradorId), gte(vendas.dataEfetiva, p.de), lte(vendas.dataEfetiva, p.ate)))
    .groupBy(vendaItens.produtoId, produtos.nome);
  const devolvido = await db
    .select({
      produtoId: vendaItens.produtoId,
      quantidade: sql<number>`sum(${vendaDevolucoes.quantidade})::int`,
      liquidoCents: sql<number>`sum(${vendaDevolucoes.liquidoCents})::int`,
      comissaoCents: sql<number>`sum(${vendaDevolucoes.comissaoCents})::int`,
    })
    .from(vendaDevolucoes)
    .innerJoin(vendaItens, eq(vendaItens.id, vendaDevolucoes.vendaItemId))
    .innerJoin(vendas, eq(vendas.id, vendaDevolucoes.vendaId))
    .where(and(eq(vendas.colaboradorId, colaboradorId), gte(vendaDevolucoes.dataEfetiva, p.de), lte(vendaDevolucoes.dataEfetiva, p.ate)))
    .groupBy(vendaItens.produtoId);
  const ids = new Set([...vendido.map((v) => v.produtoId), ...devolvido.map((d) => d.produtoId)]);
  const nomes = new Map<number, string>(vendido.map((v) => [v.produtoId, v.produto]));
  for (const id of ids) {
    if (!nomes.has(id)) {
      const [pp] = await db.select({ nome: produtos.nome }).from(produtos).where(eq(produtos.id, id));
      nomes.set(id, pp.nome);
    }
  }
  const porProduto = [...ids]
    .map((id) => {
      const v = vendido.find((x) => x.produtoId === id);
      const d = devolvido.find((x) => x.produtoId === id);
      return {
        produto: nomes.get(id)!,
        quantidade: (v?.quantidade ?? 0) - (d?.quantidade ?? 0),
        liquidoCents: (v?.liquidoCents ?? 0) - (d?.liquidoCents ?? 0),
        comissaoCents: (v?.comissaoCents ?? 0) - (d?.comissaoCents ?? 0),
      };
    })
    .sort((a, b) => a.produto.localeCompare(b.produto, "pt-BR"));
  const [nv] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(vendas)
    .where(and(eq(vendas.colaboradorId, colaboradorId), gte(vendas.dataEfetiva, p.de), lte(vendas.dataEfetiva, p.ate)));
  const ext = await extratoComissoes(db, ator, colaboradorId, p);
  return {
    colaborador: u,
    totais: {
      vendas: nv.n,
      unidades: porProduto.reduce((a, x) => a + x.quantidade, 0),
      vendasLiquidasCents: porProduto.reduce((a, x) => a + x.liquidoCents, 0),
      comissaoGeradaCents: ext.geradoCents,
      estornosCents: ext.estornosCents,
      ajustesNegativosCents: ext.ajustesNegativosCents,
      pagoCents: ext.pagoCents,
      saldoPendenteCents: ext.saldoPendenteCents,
    },
    porProduto,
    pagamentos: ext.pagamentos.map((x) => ({ data: x.dataEfetiva, valorCents: x.valorCents, observacao: x.observacao })).reverse(),
    ajustes: ext.lancamentos
      .filter((l) => l.tipo !== "gerada")
      .map((l) => ({ data: l.dataEfetiva, tipo: l.tipo, valorCents: l.valorCents, descricao: l.descricao }))
      .reverse(),
  };
}

export async function dadosComissoes(db: DB, ator: Ator, p: Periodo) {
  const linhas = await resumoComissoes(db, ator, p);
  const ativos = linhas.filter((l) => l.geradoCents || l.estornosCents || l.ajustesNegativosCents || l.pagoCents || l.saldoPendenteCents);
  const soma = (k: keyof (typeof linhas)[number]) => ativos.reduce((a, l) => a + (l[k] as number), 0);
  return {
    totais: {
      geradoCents: soma("geradoCents"),
      estornosCents: soma("estornosCents"),
      ajustesNegativosCents: soma("ajustesNegativosCents"),
      pagoCents: soma("pagoCents"),
      saldoPendenteCents: soma("saldoPendenteCents"),
    },
    linhas: ativos,
  };
}

async function montarDados(db: DB, ator: Ator, tipo: TipoRelatorio, escopoId: number, p: Periodo) {
  switch (tipo) {
    case "geral": return dadosGeral(db, ator, p);
    case "fornecedor": return dadosFornecedor(db, ator, escopoId, p);
    case "colaborador": return dadosColaborador(db, ator, escopoId, p);
    case "comissoes": return dadosComissoes(db, ator, p);
  }
}

type Dados = Awaited<ReturnType<typeof montarDados>>;

/** Hash estável dos dados (sem o retrato de estoque, que muda a cada dia). */
export function hashDados(dados: Dados): string {
  const { posicaoEstoque: _ignorado, ...resto } = dados as Record<string, unknown>;
  return createHash("sha256").update(JSON.stringify(resto)).digest("hex");
}

// ───────────────────────────── Documento ─────────────────────────────

const pct = (parte: number, todo: number) => (todo ? formatarPercentual(Math.round((parte / todo) * 10000)) : "—");

function blocosGeral(d: Awaited<ReturnType<typeof dadosGeral>>): Bloco[] {
  const r = d.resultado;
  const b: Bloco[] = [
    { tipo: "titulo", texto: "Visão geral" },
    {
      tipo: "kpis",
      itens: [
        { rotulo: "Faturamento bruto", valor: R(r.faturamentoBrutoCents) },
        { rotulo: "Receita líquida de vendas", valor: R(r.receitaLiquidaCents), destaque: true },
        { rotulo: "Resultado estimado", valor: R(r.resultadoEstimadoCents), destaque: true },
        { rotulo: "Vendas registradas", valor: String(r.quantidadeVendas) },
        { rotulo: "Unidades vendidas (líquidas)", valor: String(r.unidadesVendidas) },
        { rotulo: "Devido a fornecedores", valor: R(r.repasseDevidoTotalCents) },
      ],
    },
    {
      tipo: "tabela",
      titulo: "Demonstrativo do resultado estimado",
      colunas: [{ titulo: "Linha", largura: 6 }, { titulo: "Valor", largura: 2.5, alinhar: "right" }, { titulo: "% receita", largura: 1.5, alinhar: "right" }],
      linhas: [
        ["Faturamento bruto", R(r.faturamentoBrutoCents), ""],
        ["(−) Descontos concedidos", R(-r.descontosCents), ""],
        ["(−) Devoluções e cancelamentos (líquido)", R(-r.devolucoesCents), ""],
        ["= Receita líquida de vendas", R(r.receitaLiquidaCents), pct(r.receitaLiquidaCents, r.receitaLiquidaCents)],
        ["(−) Custo das mercadorias próprias vendidas", R(-r.cmvProprioCents), pct(r.cmvProprioCents, r.receitaLiquidaCents)],
        ["(−) Repasses de consignados vendidos", R(-r.repassesVendidosCents), pct(r.repassesVendidosCents, r.receitaLiquidaCents)],
        ["(−) Comissões geradas", R(-r.comissoesCents), pct(r.comissoesCents, r.receitaLiquidaCents)],
        ["(−) Consumo interno", R(-r.consumoInternoCents), pct(r.consumoInternoCents, r.receitaLiquidaCents)],
        ["(−) Perdas e danos", R(-r.perdasDanosCents), pct(r.perdasDanosCents, r.receitaLiquidaCents)],
      ],
      total: ["= Resultado estimado da operação com produtos", R(r.resultadoEstimadoCents), pct(r.resultadoEstimadoCents, r.receitaLiquidaCents)],
    },
    {
      tipo: "paragrafo",
      suave: true,
      texto:
        "O resultado estimado considera apenas a operação com produtos e não representa o lucro líquido do salão, pois não inclui despesas gerais da empresa." +
        (r.ajusteCustoEstoqueNegativoCents ? ` O CMV inclui ${R(r.ajusteCustoEstoqueNegativoCents)} de ajuste de custo por regularização de estoque negativo.` : ""),
    },
    {
      tipo: "tabela",
      titulo: "Recebimentos por forma de pagamento",
      colunas: [{ titulo: "Forma", largura: 6 }, { titulo: "Valor", largura: 3, alinhar: "right" }],
      linhas: d.pagamentos.map((x) => [ROTULO_FORMA[x.forma], R(x.valorCents)]),
      total: ["Total recebido", R(d.pagamentos.reduce((a, x) => a + x.valorCents, 0))],
    },
    {
      tipo: "tabela",
      titulo: "Entradas e saídas do estoque",
      colunas: [{ titulo: "Movimentação", largura: 5 }, { titulo: "Unidades", largura: 1.5, alinhar: "right" }, { titulo: "Valor a custo", largura: 2, alinhar: "right" }, { titulo: "Repasse gerado", largura: 2, alinhar: "right" }],
      linhas: d.movimentacoes.map((m) => [rotuloMovimento(m.tipo, m.classificacao), String(m.unidades), R(m.valorCustoCents), R(m.repasseCents)]),
    },
    {
      tipo: "kpis",
      itens: [
        { rotulo: "Consumo interno", valor: `${r.consumoInternoUnidades} un · ${R(r.consumoInternoCents)}` },
        { rotulo: "Perdas e danos", valor: `${r.perdasDanosUnidades} un · ${R(r.perdasDanosCents)}` },
        { rotulo: "Entradas (a custo)", valor: `${d.totais.entradasUnidades} un · ${R(d.totais.entradasValorCents)}` },
      ],
    },
    {
      tipo: "tabela",
      titulo: "Produtos mais vendidos",
      colunas: [{ titulo: "#", largura: 0.6 }, { titulo: "Produto", largura: 6 }, { titulo: "Unidades", largura: 1.6, alinhar: "right" }, { titulo: "Vendas líquidas", largura: 2.2, alinhar: "right" }],
      linhas: d.rankingProdutos.map((x, i) => [String(i + 1), x.nome, String(x.quantidade), R(x.liquidoCents)]),
    },
    {
      tipo: "tabela",
      titulo: "Ranking de colaboradores",
      colunas: [{ titulo: "#", largura: 0.6 }, { titulo: "Colaborador", largura: 5 }, { titulo: "Vendas", largura: 1.4, alinhar: "right" }, { titulo: "Vendas líquidas", largura: 2.2, alinhar: "right" }, { titulo: "Comissão", largura: 2, alinhar: "right" }],
      linhas: d.rankingColaboradores.map((x, i) => [String(i + 1), x.nome, String(x.vendas), R(x.liquidoCents), R(x.comissaoCents)]),
    },
    {
      tipo: "kpis",
      itens: [
        { rotulo: "Comissões geradas", valor: R(d.comissoes.geradasCents) },
        { rotulo: "Comissões pagas no período", valor: R(d.comissoes.pagasCents) },
        { rotulo: "Pendente ao fim do período", valor: R(d.comissoes.pendenteFimPeriodoCents), destaque: true },
      ],
    },
    {
      tipo: "tabela",
      titulo: "Valores apurados para fornecedores consignados",
      colunas: [{ titulo: "Fornecedor", largura: 4 }, { titulo: "Vendas", largura: 1.8, alinhar: "right" }, { titulo: "Consumo", largura: 1.8, alinhar: "right" }, { titulo: "Perdas/danos", largura: 1.8, alinhar: "right" }, { titulo: "Total devido", largura: 2, alinhar: "right" }],
      linhas: d.fornecedores.map((f) => [f.nome, R(f.vendasCents), R(f.consumoCents), R(f.perdasCents), R(f.totalCents)]),
      total: ["Total", R(d.fornecedores.reduce((a, f) => a + f.vendasCents, 0)), R(d.fornecedores.reduce((a, f) => a + f.consumoCents, 0)), R(d.fornecedores.reduce((a, f) => a + f.perdasCents, 0)), R(d.fornecedores.reduce((a, f) => a + f.totalCents, 0))],
    },
    { tipo: "titulo", texto: "Custos e valores do estoque (posição na data de emissão)" },
    {
      tipo: "kpis",
      itens: [
        { rotulo: "Estoque próprio a custo médio", valor: R(d.posicaoEstoque.custoEstoqueProprioCents) },
        { rotulo: "Consignado em poder (a repasse)", valor: R(d.posicaoEstoque.valorConsignadoEmPoderCents) },
        { rotulo: "Estoque total a preço de venda", valor: R(d.posicaoEstoque.valorEstoqueAPrecoDeVendaCents) },
      ],
    },
  ];
  if (d.posicaoEstoque.produtosComSaldoNegativo) {
    b.push({ tipo: "aviso", texto: `${d.posicaoEstoque.produtosComSaldoNegativo} produto(s) com saldo negativo aguardando regularização.` });
  }
  return b;
}

function blocosFornecedor(d: Awaited<ReturnType<typeof dadosFornecedor>>): Bloco[] {
  return [
    {
      tipo: "paragrafo",
      texto: `Fornecedor: ${d.fornecedor.nome}${d.fornecedor.documento ? ` — CPF/CNPJ ${d.fornecedor.documento}` : ""}${d.fornecedor.telefone ? ` — Tel. ${d.fornecedor.telefone}` : ""}`,
    },
    {
      tipo: "kpis",
      itens: [
        { rotulo: "Vendas", valor: R(d.totais.vendasCents) },
        { rotulo: "Consumo interno", valor: R(d.totais.consumoCents) },
        { rotulo: "Perdas e danos", valor: R(d.totais.perdasDanosCents) },
        { rotulo: "Total devido ao fornecedor", valor: R(d.totais.totalCents), destaque: true },
      ],
    },
    {
      tipo: "tabela",
      titulo: "Movimentações que geraram repasse",
      colunas: [
        { titulo: "Data", largura: 1.5 },
        { titulo: "Produto", largura: 4 },
        { titulo: "Origem", largura: 3 },
        { titulo: "Qtd.", largura: 1, alinhar: "right" },
        { titulo: "Repasse un.", largura: 1.8, alinhar: "right" },
        { titulo: "Total", largura: 1.8, alinhar: "right" },
      ],
      linhas: d.linhas.map((l) => [formatarData(l.data), l.produto, l.origem, String(l.quantidade), R(l.repasseUnitarioCents), R(l.totalCents)]),
      total: ["", "", "Total", String(d.linhas.reduce((a, l) => a + l.quantidade, 0)), "", R(d.totais.totalCents)],
      vazio: "Nenhuma movimentação gerou repasse neste período.",
    },
    {
      tipo: "tabela",
      titulo: "Total por produto",
      colunas: [{ titulo: "Produto", largura: 6 }, { titulo: "Quantidade", largura: 2, alinhar: "right" }, { titulo: "Total", largura: 2.4, alinhar: "right" }],
      linhas: d.porProduto.map((x) => [x.produto, String(x.quantidade), R(x.totalCents)]),
      total: ["Total geral devido", String(d.porProduto.reduce((a, x) => a + x.quantidade, 0)), R(d.totais.totalCents)],
    },
    {
      tipo: "paragrafo",
      suave: true,
      texto: "Constam apenas movimentações com obrigação de pagamento ao fornecedor: vendas, consumo interno, perdas e danos de mercadoria consignada. Devoluções de venda aparecem como estorno. Devoluções de mercadoria não vendida ao fornecedor não geram repasse e não são listadas.",
    },
  ];
}

function blocosColaborador(d: Awaited<ReturnType<typeof dadosColaborador>>): Bloco[] {
  const t = d.totais;
  return [
    { tipo: "paragrafo", texto: `Colaborador(a): ${d.colaborador.nome} (login ${d.colaborador.login})` },
    {
      tipo: "kpis",
      itens: [
        { rotulo: "Vendas líquidas", valor: R(t.vendasLiquidasCents) },
        { rotulo: "Comissão gerada", valor: R(t.comissaoGeradaCents) },
        { rotulo: "Pagamentos no período", valor: R(t.pagoCents) },
        { rotulo: "Estornos", valor: R(t.estornosCents) },
        { rotulo: "Ajustes negativos", valor: R(t.ajustesNegativosCents) },
        { rotulo: "Saldo pendente", valor: R(t.saldoPendenteCents), destaque: true },
      ],
    },
    {
      tipo: "tabela",
      titulo: "Produtos vendidos e comissões",
      colunas: [{ titulo: "Produto", largura: 5 }, { titulo: "Qtd.", largura: 1.2, alinhar: "right" }, { titulo: "Vendas líquidas", largura: 2.2, alinhar: "right" }, { titulo: "Comissão", largura: 2, alinhar: "right" }],
      linhas: d.porProduto.map((x) => [x.produto, String(x.quantidade), R(x.liquidoCents), R(x.comissaoCents)]),
      total: ["Total", String(t.unidades), R(t.vendasLiquidasCents), R(d.porProduto.reduce((a, x) => a + x.comissaoCents, 0))],
    },
    {
      tipo: "tabela",
      titulo: "Pagamentos de comissão realizados",
      colunas: [{ titulo: "Data", largura: 2 }, { titulo: "Observação", largura: 6 }, { titulo: "Valor", largura: 2.2, alinhar: "right" }],
      linhas: d.pagamentos.map((x) => [formatarData(x.data), x.observacao ?? "", R(x.valorCents)]),
      total: ["Total pago", "", R(t.pagoCents)],
      vazio: "Nenhum pagamento no período.",
    },
    {
      tipo: "tabela",
      titulo: "Estornos e ajustes negativos",
      colunas: [{ titulo: "Data", largura: 2 }, { titulo: "Descrição", largura: 6 }, { titulo: "Valor", largura: 2.2, alinhar: "right" }],
      linhas: d.ajustes.map((x) => [formatarData(x.data), x.descricao ?? x.tipo, R(x.valorCents)]),
      vazio: "Nenhum estorno ou ajuste no período.",
    },
    {
      tipo: "paragrafo",
      suave: true,
      texto: "Saldo pendente = comissões geradas − estornos − ajustes negativos − pagamentos, acumulado até o fim do período. Saldo negativo indica ajuste a compensar em comissões futuras.",
    },
  ];
}

function blocosComissoes(d: Awaited<ReturnType<typeof dadosComissoes>>): Bloco[] {
  const t = d.totais;
  return [
    {
      tipo: "kpis",
      itens: [
        { rotulo: "Geradas", valor: R(t.geradoCents) },
        { rotulo: "Estornos + ajustes", valor: R(t.estornosCents + t.ajustesNegativosCents) },
        { rotulo: "Pagas no período", valor: R(t.pagoCents) },
      ],
    },
    {
      tipo: "tabela",
      titulo: "Resumo por colaborador",
      colunas: [
        { titulo: "Colaborador", largura: 4 },
        { titulo: "Gerada", largura: 1.8, alinhar: "right" },
        { titulo: "Estornos", largura: 1.8, alinhar: "right" },
        { titulo: "Ajustes", largura: 1.8, alinhar: "right" },
        { titulo: "Pago", largura: 1.8, alinhar: "right" },
        { titulo: "Pendente", largura: 1.8, alinhar: "right" },
      ],
      linhas: d.linhas.map((l) => [l.nome, R(l.geradoCents), R(l.estornosCents), R(l.ajustesNegativosCents), R(l.pagoCents), R(l.saldoPendenteCents)]),
      total: ["Total", R(t.geradoCents), R(t.estornosCents), R(t.ajustesNegativosCents), R(t.pagoCents), R(t.saldoPendenteCents)],
    },
  ];
}

const TITULOS: Record<TipoRelatorio, string> = {
  geral: "Relatório geral",
  fornecedor: "Prestação de contas ao fornecedor",
  colaborador: "Relatório individual de colaborador",
  comissoes: "Resumo de comissões",
};

// ───────────────────────────── Emissão e versões ─────────────────────────────

export interface Alteracao { campo: string; antes: number; depois: number }

function diferencas(antes: Record<string, number>, depois: Record<string, number>): Alteracao[] {
  return Object.keys(depois)
    .filter((k) => antes?.[k] !== depois[k])
    .map((k) => ({ campo: k, antes: antes?.[k] ?? 0, depois: depois[k] }));
}

const ROTULO_CAMPO: Record<string, string> = {
  faturamentoBrutoCents: "Faturamento bruto", descontosCents: "Descontos", devolucoesCents: "Devoluções",
  receitaLiquidaCents: "Receita líquida", cmvProprioCents: "CMV próprio", repassesVendidosCents: "Repasses vendidos",
  comissoesCents: "Comissões", consumoInternoCents: "Consumo interno", perdasDanosCents: "Perdas e danos",
  resultadoEstimadoCents: "Resultado estimado", repasseDevidoTotalCents: "Devido a fornecedores", totalCents: "Total devido",
  vendasCents: "Repasse de vendas", consumoCents: "Repasse de consumo", perdasCents: "Repasse de perdas/danos",
  vendasLiquidasCents: "Vendas líquidas", comissaoGeradaCents: "Comissão gerada",
  estornosCents: "Estornos", ajustesNegativosCents: "Ajustes negativos", pagoCents: "Pago", saldoPendenteCents: "Saldo pendente",
  geradoCents: "Comissões geradas",
};

function fmtCampo(campo: string, v: number) {
  return campo.endsWith("Cents") ? R(v) : String(v);
}

export async function emitirRelatorio(
  db: DB,
  ator: Ator,
  args: { tipo: TipoRelatorio; escopoId?: number; periodo: Periodo },
) {
  exigirAdmin(ator);
  const p = validarPeriodo(args.periodo);
  const escopoId = args.tipo === "fornecedor" || args.tipo === "colaborador" ? (args.escopoId ?? 0) : 0;
  if ((args.tipo === "fornecedor" || args.tipo === "colaborador") && !escopoId) throw new ErroNegocio("Selecione o fornecedor/colaborador.");

  const dados = await montarDados(db, ator, args.tipo, escopoId, p);
  const hash = hashDados(dados);

  return db.transaction(async (tx) => {
    // serializa emissões do mesmo relatório
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${args.tipo}:${escopoId}:${p.de}:${p.ate}`}))`);
    const [ultima] = await tx
      .select()
      .from(relatorioEmissoes)
      .where(and(eq(relatorioEmissoes.tipo, args.tipo), eq(relatorioEmissoes.escopoId, escopoId), eq(relatorioEmissoes.inicio, p.de), eq(relatorioEmissoes.fim, p.ate)))
      .orderBy(desc(relatorioEmissoes.versao))
      .limit(1);
    if (ultima && ultima.hashDados === hash) return { emissao: ultima, nova: false };

    const versao = (ultima?.versao ?? 0) + 1;
    const retificado = versao > 1;
    let alteracoes: { totais: Alteracao[]; registros: unknown[] } | null = null;
    if (ultima) {
      const registros = await tx
        .select({ acao: auditoria.acao, entidade: auditoria.entidade, entidadeId: auditoria.entidadeId, justificativa: auditoria.justificativa, dataEfetiva: auditoria.dataEfetiva, criadoEm: auditoria.criadoEm, usuario: usuarios.nome })
        .from(auditoria)
        .leftJoin(usuarios, eq(usuarios.id, auditoria.usuarioId))
        .where(and(gt(auditoria.criadoEm, ultima.emitidoEm), gte(auditoria.dataEfetiva, p.de), lte(auditoria.dataEfetiva, p.ate)))
        .orderBy(asc(auditoria.id));
      alteracoes = {
        totais: diferencas((ultima.dados as { totais: Record<string, number> }).totais, dados.totais as Record<string, number>),
        registros: registros.map((r) => ({ ...r, criadoEm: r.criadoEm.toISOString() })),
      };
    }

    const cfg = await obterConfiguracoes(tx);
    const agora = new Date();
    const subtitulo =
      args.tipo === "fornecedor" ? (dados as Awaited<ReturnType<typeof dadosFornecedor>>).fornecedor.nome
      : args.tipo === "colaborador" ? (dados as Awaited<ReturnType<typeof dadosColaborador>>).colaborador.nome
      : undefined;
    const blocos: Bloco[] =
      args.tipo === "geral" ? blocosGeral(dados as Awaited<ReturnType<typeof dadosGeral>>)
      : args.tipo === "fornecedor" ? blocosFornecedor(dados as Awaited<ReturnType<typeof dadosFornecedor>>)
      : args.tipo === "colaborador" ? blocosColaborador(dados as Awaited<ReturnType<typeof dadosColaborador>>)
      : blocosComissoes(dados as Awaited<ReturnType<typeof dadosComissoes>>);
    if (alteracoes) {
      blocos.push({
        tipo: "tabela",
        titulo: `Retificação — alterações em relação à versão ${versao - 1}`,
        colunas: [{ titulo: "Indicador", largura: 5 }, { titulo: "Versão anterior", largura: 2.5, alinhar: "right" }, { titulo: "Esta versão", largura: 2.5, alinhar: "right" }],
        linhas: alteracoes.totais.map((a) => [ROTULO_CAMPO[a.campo] || a.campo, fmtCampo(a.campo, a.antes), fmtCampo(a.campo, a.depois)]),
        vazio: "Os totais não mudaram; houve alteração em detalhes do relatório.",
      });
      const regs = alteracoes.registros as { acao: string; justificativa: string | null; dataEfetiva: string; usuario: string | null; criadoEm: string }[];
      if (regs.length) {
        blocos.push({
          tipo: "tabela",
          titulo: "Registros de auditoria que originaram a retificação",
          colunas: [{ titulo: "Registrado em", largura: 2.4 }, { titulo: "Data efetiva", largura: 1.8 }, { titulo: "Ação", largura: 2.6 }, { titulo: "Usuário", largura: 2 }, { titulo: "Justificativa", largura: 4 }],
          linhas: regs.map((r) => [formatarDataHora(new Date(r.criadoEm)), formatarData(r.dataEfetiva), r.acao.replace(/_/g, " "), r.usuario ?? "", r.justificativa ?? ""]),
        });
      }
    }

    const modelo: ModeloDocumento = {
      titulo: TITULOS[args.tipo],
      subtitulo,
      periodo: `${formatarData(p.de)} a ${formatarData(p.ate)}`,
      emitidoEm: formatarDataHora(agora),
      emitidoPor: ator.nome,
      versao,
      retificado,
      empresa: { nomeFantasia: cfg.nomeFantasia, razaoSocial: cfg.razaoSocial, cnpj: cfg.cnpj, endereco: cfg.endereco, telefone: cfg.telefone, logotipo: cfg.logotipo },
      blocos,
    };
    const pdf = await renderizarPdf(modelo);
    const [emissao] = await tx
      .insert(relatorioEmissoes)
      .values({
        tipo: args.tipo,
        escopoId,
        inicio: p.de,
        fim: p.ate,
        versao,
        retificado,
        hashDados: hash,
        dados: JSON.parse(JSON.stringify(dados)),
        alteracoes,
        pdfBase64: pdf.toString("base64"),
        emitidoPor: ator.id,
        emitidoEm: agora,
      })
      .returning();
    return { emissao, nova: true };
  });
}

/** Central de Relatórios: emite o pacote de fechamento do período (spec §12). */
export async function fechamento(db: DB, ator: Ator, periodo: Periodo) {
  exigirAdmin(ator);
  const p = validarPeriodo(periodo);
  const resultados = [];
  resultados.push(await emitirRelatorio(db, ator, { tipo: "geral", periodo: p }));
  resultados.push(await emitirRelatorio(db, ator, { tipo: "comissoes", periodo: p }));
  const fornecedoresComRepasse = await db
    .selectDistinct({ id: movimentacoes.fornecedorId })
    .from(movimentacoes)
    .where(and(eq(movimentacoes.modalidade, "consignado"), eq(movimentacoes.anulada, false), ne(movimentacoes.repasseTotalCents, 0), gte(movimentacoes.dataEfetiva, p.de), lte(movimentacoes.dataEfetiva, p.ate)));
  for (const f of fornecedoresComRepasse) {
    if (f.id) resultados.push(await emitirRelatorio(db, ator, { tipo: "fornecedor", escopoId: f.id, periodo: p }));
  }
  const colaboradoresAtivos = await db.execute<{ id: number }>(sql`
    select distinct colaborador_id as id from vendas where data_efetiva between ${p.de} and ${p.ate}
    union select distinct colaborador_id from comissao_lancamentos where data_efetiva between ${p.de} and ${p.ate}
    union select distinct colaborador_id from comissao_pagamentos where data_efetiva between ${p.de} and ${p.ate}`);
  const linhasColab = (colaboradoresAtivos as unknown as { rows: { id: number }[] }).rows;
  for (const c of linhasColab) resultados.push(await emitirRelatorio(db, ator, { tipo: "colaborador", escopoId: Number(c.id), periodo: p }));
  return resultados;
}

export async function listarEmissoes(db: DB, ator: Ator, filtro: { de?: string; ate?: string; limite?: number } = {}) {
  exigirAdmin(ator);
  const conds = [];
  if (filtro.de) conds.push(gte(relatorioEmissoes.inicio, filtro.de));
  if (filtro.ate) conds.push(lte(relatorioEmissoes.fim, filtro.ate));
  const linhas = await db
    .select({
      id: relatorioEmissoes.id,
      tipo: relatorioEmissoes.tipo,
      escopoId: relatorioEmissoes.escopoId,
      inicio: relatorioEmissoes.inicio,
      fim: relatorioEmissoes.fim,
      versao: relatorioEmissoes.versao,
      retificado: relatorioEmissoes.retificado,
      emitidoEm: relatorioEmissoes.emitidoEm,
      emitidoPor: usuarios.nome,
    })
    .from(relatorioEmissoes)
    .innerJoin(usuarios, eq(usuarios.id, relatorioEmissoes.emitidoPor))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(relatorioEmissoes.emitidoEm), desc(relatorioEmissoes.id))
    .limit(filtro.limite ?? 200);
  // nome do escopo (fornecedor/colaborador)
  const forn = await db.select({ id: fornecedores.id, nome: fornecedores.nome }).from(fornecedores);
  const pess = await db.select({ id: usuarios.id, nome: usuarios.nome }).from(usuarios);
  return linhas.map((l) => ({
    ...l,
    titulo: TITULOS[l.tipo],
    escopo: l.tipo === "fornecedor" ? forn.find((f) => f.id === l.escopoId)?.nome : l.tipo === "colaborador" ? pess.find((u) => u.id === l.escopoId)?.nome : null,
  }));
}

export async function obterPdf(db: DB, ator: Ator, id: number) {
  exigirAdmin(ator);
  const [e] = await db.select().from(relatorioEmissoes).where(eq(relatorioEmissoes.id, id));
  if (!e) throw new ErroNegocio("Relatório não encontrado.");
  const nome = `casafro-${e.tipo}${e.escopoId ? `-${e.escopoId}` : ""}-${e.inicio}_${e.fim}-v${e.versao}${e.retificado ? "-retificado" : ""}.pdf`;
  return { nome, pdf: Buffer.from(e.pdfBase64, "base64") };
}

