/**
 * Estoque (spec §5, §6, §9).
 *
 * Regras centrais:
 *  - Próprios: custo médio ponderado, atualizado a cada entrada (ordem de registro).
 *  - Consignados: repasse fixo por unidade, congelado na movimentação.
 *  - Saída sem saldo (estoque negativo) é permitida; para próprios, as unidades sem saldo recebem
 *    custo ESTIMADO (custo médio vigente) e ficam "pendentes". Quando uma entrada regulariza o saldo,
 *    a diferença entre custo real e estimado é lançada como `ajuste_custo_cents` na entrada.
 *  - Saldo inicial de implantação: movimentações com data anterior à implantação são históricas
 *    (valem para o financeiro, não alteram a quantidade), evitando contar o estoque em dobro.
 *  - Correção = anulação (com justificativa) + novo lançamento vinculado. Nada é apagado.
 */
import { and, asc, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db";
import { fornecedores, movimentacoes, produtos, usuarios } from "../db/schema";
import { ErroNegocio } from "../erros";
import { arred } from "@/domain/money";
import { hoje, validarData } from "@/domain/datas";
import { auditar } from "./auditoria";
import { exigirAdmin, type Ator } from "./permissoes";

export type Produto = typeof produtos.$inferSelect;
export type Movimento = typeof movimentacoes.$inferSelect;
export type TipoMovimento = Movimento["tipo"];
export type Classificacao = NonNullable<Movimento["classificacao"]>;

/** Efeito financeiro de uma saída. */
type Efeito = "despesa" | "repasse_ou_despesa" | "nenhum" | "venda";

export async function travarProduto(tx: DB, id: number): Promise<Produto> {
  const [p] = await tx.select().from(produtos).where(eq(produtos.id, id)).for("update");
  if (!p) throw new ErroNegocio(`Produto ${id} não encontrado.`);
  return p;
}

export function afetaEstoque(p: Produto, data: string): boolean {
  return !p.dataImplantacao || data >= p.dataImplantacao;
}

function validarDataEfetiva(data: string | undefined): string {
  const d = data ? validarData(data) : hoje();
  if (d > hoje()) throw new ErroNegocio("A data efetiva não pode estar no futuro.");
  return d;
}

export interface ResultadoSaida {
  mov: Movimento;
  custoUnitarioCents: number;
  custoTotalCents: number;
  repasseUnitarioCents: number;
  repasseTotalCents: number;
  qtdSemSaldo: number;
}

/**
 * Lança uma saída de `qtd` unidades (qtd > 0). Para vendas, o custo/repasse calculado é
 * devolvido para ser congelado também no item da venda.
 */
export async function lancarSaida(
  tx: DB,
  ator: Ator,
  p: Produto,
  args: {
    tipo: TipoMovimento;
    qtd: number;
    data: string;
    efeito: Efeito;
    justificativa?: string | null;
    classificacao?: Classificacao | null;
    custoUnitarioCents?: number;
    repasseUnitarioCents?: number;
    vendaItemId?: number;
    corrigeId?: number;
  },
): Promise<ResultadoSaida> {
  const { qtd } = args;
  if (!Number.isInteger(qtd) || qtd <= 0) throw new ErroNegocio("Quantidade deve ser um número inteiro positivo.");
  const afeta = afetaEstoque(p, args.data);

  let custoUnit = 0;
  let repasseUnit = 0;
  let qtdSemSaldo = 0;
  if (p.modalidade === "proprio") {
    custoUnit = args.custoUnitarioCents ?? p.custoMedioCents;
    if (afeta) qtdSemSaldo = qtd - Math.min(qtd, Math.max(p.quantidade, 0));
  } else {
    repasseUnit = args.repasseUnitarioCents ?? p.repasseCents;
  }

  // Impacto financeiro conforme o tipo de saída.
  let custoTotal = 0;
  let repasseTotal = 0;
  if (args.efeito === "venda") {
    custoTotal = p.modalidade === "proprio" ? custoUnit * qtd : 0;
    repasseTotal = p.modalidade === "consignado" ? repasseUnit * qtd : 0;
  } else if (args.efeito === "repasse_ou_despesa") {
    // consumo interno, perda, dano: próprio vira despesa de custo; consignado gera repasse (custo da CasAfro).
    if (p.modalidade === "proprio") custoTotal = custoUnit * qtd;
    else repasseTotal = repasseUnit * qtd;
  }

  const [mov] = await tx
    .insert(movimentacoes)
    .values({
      tipo: args.tipo,
      produtoId: p.id,
      quantidade: -qtd,
      dataEfetiva: args.data,
      usuarioId: ator.id,
      justificativa: args.justificativa ?? null,
      classificacao: args.classificacao ?? null,
      modalidade: p.modalidade,
      fornecedorId: p.fornecedorId,
      custoUnitarioCents: custoUnit,
      custoTotalCents: args.efeito === "venda" ? 0 : custoTotal, // custo de venda fica no item (CMV)
      repasseUnitarioCents: repasseUnit,
      repasseTotalCents: repasseTotal,
      afetaEstoque: afeta,
      vendaItemId: args.vendaItemId ?? null,
      corrigeId: args.corrigeId ?? null,
    })
    .returning();

  if (afeta) {
    const pend =
      qtdSemSaldo > 0
        ? { pendenteQtd: p.pendenteQtd + qtdSemSaldo, pendenteCustoCents: p.pendenteCustoCents + qtdSemSaldo * custoUnit }
        : {};
    await tx.update(produtos).set({ quantidade: p.quantidade - qtd, ...pend }).where(eq(produtos.id, p.id));
    Object.assign(p, { quantidade: p.quantidade - qtd }, pend);
  }

  return {
    mov,
    custoUnitarioCents: custoUnit,
    custoTotalCents: custoTotal,
    repasseUnitarioCents: repasseUnit,
    repasseTotalCents: repasseTotal,
    qtdSemSaldo,
  };
}

/** Lança uma entrada de `qtd` unidades, atualizando custo médio e regularizando pendências. */
export async function lancarEntrada(
  tx: DB,
  ator: Ator,
  p: Produto,
  args: {
    tipo: TipoMovimento;
    qtd: number;
    data: string;
    custoUnitarioCents?: number;
    justificativa?: string | null;
    classificacao?: Classificacao | null;
    /** Entradas que não são compra (ajuste positivo, devolução de venda) não mexem no custo médio. */
    atualizaCustoMedio: boolean;
    corrigeId?: number;
    vendaItemId?: number;
    repasseUnitarioCents?: number;
    repasseTotalCents?: number;
    custoTotalCents?: number;
  },
): Promise<Movimento> {
  const { qtd } = args;
  if (!Number.isInteger(qtd) || qtd <= 0) throw new ErroNegocio("Quantidade deve ser um número inteiro positivo.");
  const afeta = afetaEstoque(p, args.data);
  const custoUnit = p.modalidade === "proprio" ? (args.custoUnitarioCents ?? p.custoMedioCents) : 0;

  let ajusteCusto = 0;
  const novo: Partial<Produto> = {};
  if (afeta) {
    novo.quantidade = p.quantidade + qtd;
    if (p.modalidade === "proprio" && args.atualizaCustoMedio) {
      // 1) regulariza unidades vendidas sem saldo (custo estimado → real)
      const coberto = Math.min(qtd, p.pendenteQtd);
      if (coberto > 0) {
        const estimado = arred(p.pendenteCustoCents * coberto, p.pendenteQtd);
        ajusteCusto = coberto * custoUnit - estimado;
        novo.pendenteQtd = p.pendenteQtd - coberto;
        novo.pendenteCustoCents = p.pendenteCustoCents - estimado;
      }
      // 2) custo médio ponderado sobre o saldo positivo existente + unidades que sobram após cobrir o negativo
      const saldoPositivo = Math.max(p.quantidade, 0);
      const cobreNegativo = Math.min(qtd, Math.max(-p.quantidade, 0));
      const restantes = qtd - cobreNegativo;
      if (saldoPositivo + restantes > 0 && restantes > 0) {
        novo.custoMedioCents = arred(saldoPositivo * p.custoMedioCents + restantes * custoUnit, saldoPositivo + restantes);
      }
    }
  }

  const [mov] = await tx
    .insert(movimentacoes)
    .values({
      tipo: args.tipo,
      produtoId: p.id,
      quantidade: qtd,
      dataEfetiva: args.data,
      usuarioId: ator.id,
      justificativa: args.justificativa ?? null,
      classificacao: args.classificacao ?? null,
      modalidade: p.modalidade,
      fornecedorId: p.fornecedorId,
      custoUnitarioCents: custoUnit,
      custoTotalCents: args.custoTotalCents ?? 0,
      repasseUnitarioCents: args.repasseUnitarioCents ?? (p.modalidade === "consignado" ? p.repasseCents : 0),
      repasseTotalCents: args.repasseTotalCents ?? 0,
      ajusteCustoCents: ajusteCusto,
      afetaEstoque: afeta,
      corrigeId: args.corrigeId ?? null,
      vendaItemId: args.vendaItemId ?? null,
    })
    .returning();

  if (Object.keys(novo).length) {
    await tx.update(produtos).set(novo).where(eq(produtos.id, p.id));
    Object.assign(p, novo);
  }
  return mov;
}

// ───────────────────────────── Operações administrativas ─────────────────────────────

const TIPOS_SAIDA = ["consumo_interno", "perda", "dano", "devolucao_fornecedor"] as const;

const esquemaEntrada = z.object({
  produtoId: z.number().int().positive(),
  quantidade: z.number().int().positive("Quantidade deve ser inteira e positiva"),
  /** Próprio: custo unitário da compra (obrigatório). */
  custoUnitarioCents: z.number().int().min(0).optional(),
  dataEfetiva: z.string().optional(),
  justificativa: z.string().trim().max(500).optional(),
});

export async function registrarEntrada(db: DB, ator: Ator, dados: z.input<typeof esquemaEntrada>, corrigeId?: number) {
  exigirAdmin(ator);
  const v = esquemaEntrada.parse(dados);
  const data = validarDataEfetiva(v.dataEfetiva);
  const exec = async (tx: DB) => {
    const p = await travarProduto(tx, v.produtoId);
    if (p.modalidade === "proprio" && v.custoUnitarioCents === undefined) {
      throw new ErroNegocio("Informe o custo unitário da compra.");
    }
    const mov = await lancarEntrada(tx, ator, p, {
      tipo: "entrada",
      qtd: v.quantidade,
      data,
      custoUnitarioCents: v.custoUnitarioCents,
      justificativa: v.justificativa,
      atualizaCustoMedio: true,
      corrigeId,
    });
    await auditar(tx, ator, { acao: "entrada", entidade: "movimentacao", entidadeId: mov.id, depois: mov, justificativa: v.justificativa, dataEfetiva: data });
    return mov;
  };
  return corrigeId ? exec(db) : db.transaction(exec);
}

const esquemaSaida = z.object({
  produtoId: z.number().int().positive(),
  tipo: z.enum(TIPOS_SAIDA),
  quantidade: z.number().int().positive("Use unidades inteiras"),
  dataEfetiva: z.string().optional(),
  justificativa: z.string().trim().max(500).optional(),
  /** Valores praticados na época (lançamentos retroativos). */
  custoUnitarioCents: z.number().int().min(0).optional(),
  repasseUnitarioCents: z.number().int().min(0).optional(),
});

export async function registrarSaida(db: DB, ator: Ator, dados: z.input<typeof esquemaSaida>, corrigeId?: number) {
  exigirAdmin(ator);
  const v = esquemaSaida.parse(dados);
  const data = validarDataEfetiva(v.dataEfetiva);
  const exec = async (tx: DB) => {
    const p = await travarProduto(tx, v.produtoId);
    const r = await lancarSaida(tx, ator, p, {
      tipo: v.tipo,
      qtd: v.quantidade,
      data,
      efeito: v.tipo === "devolucao_fornecedor" ? "nenhum" : "repasse_ou_despesa",
      justificativa: v.justificativa,
      custoUnitarioCents: v.custoUnitarioCents,
      repasseUnitarioCents: v.repasseUnitarioCents,
      corrigeId,
    });
    await auditar(tx, ator, { acao: v.tipo, entidade: "movimentacao", entidadeId: r.mov.id, depois: r.mov, justificativa: v.justificativa, dataEfetiva: data });
    return r.mov;
  };
  return corrigeId ? exec(db) : db.transaction(exec);
}

const esquemaInventario = z.object({
  produtoId: z.number().int().positive(),
  quantidadeContada: z.number().int().min(0),
  dataEfetiva: z.string().optional(),
  justificativa: z.string().trim().min(3, "Justificativa obrigatória em ajuste de inventário").max(500),
  /** Obrigatória quando o físico é menor que o registrado (spec §6). */
  classificacao: z.enum(["perda", "dano", "consumo_interno", "devolucao_fornecedor", "erro_registro"]).optional(),
});

/** Efeito financeiro de cada classificação de divergência negativa. */
const EFEITO_CLASSIFICACAO: Record<Classificacao, Efeito> = {
  perda: "repasse_ou_despesa",
  dano: "repasse_ou_despesa",
  consumo_interno: "repasse_ou_despesa",
  devolucao_fornecedor: "nenhum",
  erro_registro: "nenhum",
};

export async function ajustarInventario(db: DB, ator: Ator, dados: z.input<typeof esquemaInventario>) {
  exigirAdmin(ator);
  const v = esquemaInventario.parse(dados);
  const data = validarDataEfetiva(v.dataEfetiva);
  return db.transaction(async (tx) => {
    const p = await travarProduto(tx, v.produtoId);
    if (!afetaEstoque(p, data)) throw new ErroNegocio("Inventário não pode ter data anterior à implantação do produto.");
    const diferenca = v.quantidadeContada - p.quantidade;
    if (diferenca === 0) throw new ErroNegocio("Não há divergência entre o físico e o registrado.");
    let mov: Movimento;
    if (diferenca > 0) {
      mov = await lancarEntrada(tx, ator, p, {
        tipo: "ajuste_inventario",
        qtd: diferenca,
        data,
        justificativa: v.justificativa,
        atualizaCustoMedio: false,
      });
    } else {
      if (!v.classificacao) {
        throw new ErroNegocio("Classifique a divergência (perda, dano, consumo interno, devolução ou erro de registro) antes de definir o repasse.");
      }
      const r = await lancarSaida(tx, ator, p, {
        tipo: "ajuste_inventario",
        qtd: -diferenca,
        data,
        efeito: EFEITO_CLASSIFICACAO[v.classificacao],
        classificacao: v.classificacao,
        justificativa: v.justificativa,
      });
      mov = r.mov;
    }
    await auditar(tx, ator, {
      acao: "ajuste_inventario",
      entidade: "movimentacao",
      entidadeId: mov.id,
      antes: { quantidadeRegistrada: v.quantidadeContada - diferenca },
      depois: { quantidadeContada: v.quantidadeContada, diferenca, classificacao: v.classificacao ?? null },
      justificativa: v.justificativa,
      dataEfetiva: data,
    });
    return mov;
  });
}

const esquemaSaldoInicial = z.object({
  produtoId: z.number().int().positive(),
  quantidade: z.number().int().min(0),
  dataImplantacao: z.string(),
  custoUnitarioCents: z.number().int().min(0).optional(),
  justificativa: z.string().trim().max(500).optional(),
});

/**
 * Saldo inicial de implantação (spec §6). Movimentações com data anterior passam a ser
 * apenas históricas; as posteriores continuam somando ao saldo informado.
 */
export async function definirSaldoInicial(db: DB, ator: Ator, dados: z.input<typeof esquemaSaldoInicial>) {
  exigirAdmin(ator);
  const v = esquemaSaldoInicial.parse(dados);
  const data = validarDataEfetiva(v.dataImplantacao);
  return db.transaction(async (tx) => {
    const p = await travarProduto(tx, v.produtoId);
    const [existente] = await tx
      .select({ id: movimentacoes.id })
      .from(movimentacoes)
      .where(and(eq(movimentacoes.produtoId, p.id), eq(movimentacoes.tipo, "saldo_inicial"), eq(movimentacoes.anulada, false)));
    if (existente) throw new ErroNegocio("Este produto já possui saldo inicial. Para corrigir, anule o saldo inicial anterior.");

    await tx
      .update(movimentacoes)
      .set({ afetaEstoque: false })
      .where(and(eq(movimentacoes.produtoId, p.id), sql`${movimentacoes.dataEfetiva} < ${data}`, eq(movimentacoes.afetaEstoque, true)));
    await tx
      .update(movimentacoes)
      .set({ afetaEstoque: true })
      .where(and(eq(movimentacoes.produtoId, p.id), sql`${movimentacoes.dataEfetiva} >= ${data}`, eq(movimentacoes.afetaEstoque, false)));

    const custo = p.modalidade === "proprio" ? (v.custoUnitarioCents ?? p.custoMedioCents) : 0;
    const [mov] = await tx
      .insert(movimentacoes)
      .values({
        tipo: "saldo_inicial",
        produtoId: p.id,
        quantidade: v.quantidade,
        dataEfetiva: data,
        usuarioId: ator.id,
        justificativa: v.justificativa ?? "Saldo inicial de implantação",
        modalidade: p.modalidade,
        fornecedorId: p.fornecedorId,
        custoUnitarioCents: custo,
        repasseUnitarioCents: p.modalidade === "consignado" ? p.repasseCents : 0,
        afetaEstoque: true,
      })
      .returning();
    const quantidade = await somaEstoque(tx, p.id);
    await tx
      .update(produtos)
      .set({ dataImplantacao: data, quantidade, custoMedioCents: custo, pendenteQtd: 0, pendenteCustoCents: 0 })
      .where(eq(produtos.id, p.id));
    await auditar(tx, ator, {
      acao: "saldo_inicial",
      entidade: "produto",
      entidadeId: p.id,
      antes: { quantidade: p.quantidade, custoMedioCents: p.custoMedioCents, dataImplantacao: p.dataImplantacao },
      depois: { quantidade, custoMedioCents: custo, dataImplantacao: data },
      justificativa: v.justificativa,
      dataEfetiva: data,
    });
    return mov;
  });
}

/** Saldo pela soma das movimentações ativas que afetam estoque (fonte da verdade). */
export async function somaEstoque(tx: DB, produtoId: number): Promise<number> {
  const [r] = await tx
    .select({ q: sql<number>`coalesce(sum(${movimentacoes.quantidade}), 0)::int` })
    .from(movimentacoes)
    .where(and(eq(movimentacoes.produtoId, produtoId), eq(movimentacoes.anulada, false), eq(movimentacoes.afetaEstoque, true)));
  return r.q;
}

// ───────────────────────────── Correções ─────────────────────────────

const TIPOS_CORRIGIVEIS: TipoMovimento[] = ["entrada", "consumo_interno", "perda", "dano", "devolucao_fornecedor", "ajuste_inventario", "saldo_inicial"];

/** Anula uma movimentação (sem apagar), revertendo o efeito no estoque. Uso interno (dentro de transação). */
async function anularDentro(tx: DB, ator: Ator, id: number, justificativa: string): Promise<{ antes: Movimento; produto: Produto }> {
  const [m] = await tx.select().from(movimentacoes).where(eq(movimentacoes.id, id)).for("update");
  if (!m) throw new ErroNegocio("Movimentação não encontrada.");
  if (m.anulada) throw new ErroNegocio("Esta movimentação já foi anulada.");
  if (!TIPOS_CORRIGIVEIS.includes(m.tipo)) {
    throw new ErroNegocio("Movimentações de venda são corrigidas pelo cancelamento/devolução da venda.");
  }
  if (m.ajusteCustoCents !== 0) {
    throw new ErroNegocio("Esta entrada regularizou estoque negativo e não pode ser anulada; registre um ajuste de inventário.");
  }
  const p = await travarProduto(tx, m.produtoId);
  await tx
    .update(movimentacoes)
    .set({ anulada: true, anuladaEm: new Date(), anuladaPor: ator.id })
    .where(eq(movimentacoes.id, id));

  const novo: Partial<Produto> = {};
  if (m.tipo === "saldo_inicial") {
    // volta ao modo sem implantação: todas as movimentações ativas passam a afetar o estoque
    await tx.update(movimentacoes).set({ afetaEstoque: true }).where(and(eq(movimentacoes.produtoId, p.id), eq(movimentacoes.afetaEstoque, false)));
    novo.dataImplantacao = null;
    novo.quantidade = await somaEstoque(tx, p.id);
  } else if (m.afetaEstoque) {
    novo.quantidade = p.quantidade - m.quantidade;
    if (p.modalidade === "proprio" && m.tipo === "entrada" && m.quantidade > 0) {
      const restante = p.quantidade - m.quantidade;
      if (restante > 0) {
        novo.custoMedioCents = Math.max(0, arred(p.quantidade * p.custoMedioCents - m.quantidade * m.custoUnitarioCents, restante));
      }
    }
    if (m.quantidade < 0 && p.pendenteQtd > 0) {
      const red = Math.min(p.pendenteQtd, -m.quantidade);
      const valor = arred(p.pendenteCustoCents * red, p.pendenteQtd);
      novo.pendenteQtd = p.pendenteQtd - red;
      novo.pendenteCustoCents = p.pendenteCustoCents - valor;
    }
  }
  if (Object.keys(novo).length) {
    await tx.update(produtos).set(novo).where(eq(produtos.id, p.id));
    Object.assign(p, novo);
  }
  return { antes: m, produto: p };
}

export async function anularMovimentacao(db: DB, ator: Ator, id: number, justificativa: string) {
  exigirAdmin(ator);
  if (!justificativa?.trim() || justificativa.trim().length < 3) throw new ErroNegocio("Justificativa obrigatória para anular.");
  return db.transaction(async (tx) => {
    const { antes } = await anularDentro(tx, ator, id, justificativa);
    await auditar(tx, ator, { acao: "anular_movimentacao", entidade: "movimentacao", entidadeId: id, antes, depois: { anulada: true }, justificativa, dataEfetiva: antes.dataEfetiva });
  });
}

const esquemaCorrecao = z.object({
  quantidade: z.number().int().positive(),
  dataEfetiva: z.string(),
  custoUnitarioCents: z.number().int().min(0).optional(),
  repasseUnitarioCents: z.number().int().min(0).optional(),
  justificativa: z.string().trim().min(3, "Justificativa obrigatória na correção").max(500),
});

/**
 * Corrige uma entrada ou saída administrativa: anula a original e lança a versão correta,
 * vinculando ambas (spec §6, §13). Ajustes de inventário são corrigidos anulando e refazendo a contagem.
 */
export async function corrigirMovimentacao(db: DB, ator: Ator, id: number, dados: z.input<typeof esquemaCorrecao>) {
  exigirAdmin(ator);
  const v = esquemaCorrecao.parse(dados);
  return db.transaction(async (tx) => {
    const { antes } = await anularDentro(tx, ator, id, v.justificativa);
    let novo: Movimento;
    if (antes.tipo === "entrada") {
      novo = await registrarEntrada(tx, ator, {
        produtoId: antes.produtoId,
        quantidade: v.quantidade,
        custoUnitarioCents: v.custoUnitarioCents ?? antes.custoUnitarioCents,
        dataEfetiva: v.dataEfetiva,
        justificativa: v.justificativa,
      }, id);
    } else if ((TIPOS_SAIDA as readonly string[]).includes(antes.tipo)) {
      novo = await registrarSaida(tx, ator, {
        produtoId: antes.produtoId,
        tipo: antes.tipo as (typeof TIPOS_SAIDA)[number],
        quantidade: v.quantidade,
        dataEfetiva: v.dataEfetiva,
        justificativa: v.justificativa,
        custoUnitarioCents: antes.modalidade === "proprio" ? (v.custoUnitarioCents ?? antes.custoUnitarioCents) : undefined,
        repasseUnitarioCents: antes.modalidade === "consignado" ? (v.repasseUnitarioCents ?? antes.repasseUnitarioCents) : undefined,
      }, id);
    } else {
      throw new ErroNegocio("Este tipo de movimentação deve ser anulado e lançado novamente.");
    }
    await tx.update(movimentacoes).set({ substituidaPor: novo.id }).where(eq(movimentacoes.id, id));
    await auditar(tx, ator, {
      acao: "corrigir_movimentacao",
      entidade: "movimentacao",
      entidadeId: id,
      antes,
      depois: novo,
      justificativa: v.justificativa,
      dataEfetiva: antes.dataEfetiva < novo.dataEfetiva ? antes.dataEfetiva : novo.dataEfetiva,
    });
    return novo;
  });
}

// ───────────────────────────── Consultas ─────────────────────────────

export async function listarMovimentacoes(
  db: DB,
  ator: Ator,
  filtro: { produtoId?: number; tipo?: TipoMovimento; de?: string; ate?: string; incluirAnuladas?: boolean; limite?: number } = {},
) {
  exigirAdmin(ator);
  const conds: SQL[] = [];
  if (filtro.produtoId) conds.push(eq(movimentacoes.produtoId, filtro.produtoId));
  if (filtro.tipo) conds.push(eq(movimentacoes.tipo, filtro.tipo));
  if (filtro.de) conds.push(gte(movimentacoes.dataEfetiva, filtro.de));
  if (filtro.ate) conds.push(lte(movimentacoes.dataEfetiva, filtro.ate));
  if (!filtro.incluirAnuladas) conds.push(eq(movimentacoes.anulada, false));
  return db
    .select({
      mov: movimentacoes,
      produto: produtos.nome,
      fornecedor: fornecedores.nome,
      usuario: usuarios.nome,
    })
    .from(movimentacoes)
    .innerJoin(produtos, eq(produtos.id, movimentacoes.produtoId))
    .leftJoin(fornecedores, eq(fornecedores.id, movimentacoes.fornecedorId))
    .innerJoin(usuarios, eq(usuarios.id, movimentacoes.usuarioId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(movimentacoes.dataEfetiva), desc(movimentacoes.id))
    .limit(filtro.limite ?? 300);
}

/** Verificação de consistência: saldo em cache == soma das movimentações. */
export async function verificarConsistencia(db: DB) {
  const ps = await db.select({ id: produtos.id, nome: produtos.nome, quantidade: produtos.quantidade }).from(produtos).orderBy(asc(produtos.id));
  const divergentes = [];
  for (const p of ps) {
    const soma = await somaEstoque(db, p.id);
    if (soma !== p.quantidade) divergentes.push({ ...p, soma });
  }
  return divergentes;
}
