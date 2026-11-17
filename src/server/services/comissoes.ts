/**
 * Comissões (spec §8). Razão (ledger) por colaborador:
 *   saldo pendente = Σ lançamentos (gerada > 0, estorno < 0, ajuste_negativo < 0) − Σ pagamentos.
 * Nada é editado ou apagado; estornos de comissão já paga viram "ajuste negativo"
 * a compensar em comissões futuras (o pagamento anterior permanece intacto).
 */
import { and, asc, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db";
import { comissaoLancamentos, comissaoPagamentos, usuarios } from "../db/schema";
import { ErroNegocio } from "../erros";
import { hoje, validarData } from "@/domain/datas";
import { auditar } from "./auditoria";
import { exigirAdmin, exigirProprioOuAdmin, type Ator } from "./permissoes";

async function somaLancamentos(tx: DB, colaboradorId: number, conds: SQL[] = []) {
  const [r] = await tx
    .select({
      gerada: sql<number>`coalesce(sum(case when ${comissaoLancamentos.tipo} = 'gerada' then ${comissaoLancamentos.valorCents} end), 0)::int`,
      estornos: sql<number>`coalesce(sum(case when ${comissaoLancamentos.tipo} = 'estorno' then ${comissaoLancamentos.valorCents} end), 0)::int`,
      ajustes: sql<number>`coalesce(sum(case when ${comissaoLancamentos.tipo} = 'ajuste_negativo' then ${comissaoLancamentos.valorCents} end), 0)::int`,
    })
    .from(comissaoLancamentos)
    .where(and(eq(comissaoLancamentos.colaboradorId, colaboradorId), ...conds));
  return r;
}

async function somaPagamentos(tx: DB, colaboradorId: number, conds: SQL[] = []) {
  const [r] = await tx
    .select({ pago: sql<number>`coalesce(sum(${comissaoPagamentos.valorCents}), 0)::int` })
    .from(comissaoPagamentos)
    .where(and(eq(comissaoPagamentos.colaboradorId, colaboradorId), ...conds));
  return r.pago;
}

/** Saldo pendente atual (pode ser negativo quando há ajuste a compensar). */
export async function saldoPendente(tx: DB, colaboradorId: number): Promise<number> {
  const l = await somaLancamentos(tx, colaboradorId);
  return l.gerada + l.estornos + l.ajustes - (await somaPagamentos(tx, colaboradorId));
}

/** Trava o colaborador para serializar operações no seu razão de comissões. */
async function travarColaborador(tx: DB, colaboradorId: number) {
  await tx.select({ id: usuarios.id }).from(usuarios).where(eq(usuarios.id, colaboradorId)).for("update");
}

/**
 * Estorna `valor` (> 0) de comissão: a parte coberta pelo saldo pendente é "estorno";
 * o excedente (comissão já paga) vira "ajuste_negativo" para compensação futura.
 */
export async function estornarComissao(
  tx: DB,
  ator: Ator,
  args: { colaboradorId: number; valorCents: number; dataEfetiva: string; vendaId: number; vendaItemId: number; descricao: string },
) {
  if (args.valorCents <= 0) return;
  await travarColaborador(tx, args.colaboradorId);
  const saldo = await saldoPendente(tx, args.colaboradorId);
  const estorno = Math.min(args.valorCents, Math.max(saldo, 0));
  const ajuste = args.valorCents - estorno;
  const base = {
    colaboradorId: args.colaboradorId,
    dataEfetiva: args.dataEfetiva,
    vendaId: args.vendaId,
    vendaItemId: args.vendaItemId,
    registradoPor: ator.id,
  };
  if (estorno > 0) {
    await tx.insert(comissaoLancamentos).values({ ...base, tipo: "estorno", valorCents: -estorno, descricao: `Estorno — ${args.descricao}` });
  }
  if (ajuste > 0) {
    await tx.insert(comissaoLancamentos).values({
      ...base,
      tipo: "ajuste_negativo",
      valorCents: -ajuste,
      descricao: `Ajuste negativo (comissão já paga) — ${args.descricao}`,
    });
  }
}

const esquemaPagamento = z.object({
  colaboradorId: z.number().int().positive(),
  valorCents: z.number().int().positive("Valor deve ser positivo"),
  dataEfetiva: z.string().optional(),
  observacao: z.string().trim().max(300).optional(),
});

export async function registrarPagamentoComissao(db: DB, ator: Ator, dados: z.input<typeof esquemaPagamento>) {
  exigirAdmin(ator);
  const v = esquemaPagamento.parse(dados);
  const data = v.dataEfetiva ? validarData(v.dataEfetiva) : hoje();
  if (data > hoje()) throw new ErroNegocio("A data do pagamento não pode estar no futuro.");
  return db.transaction(async (tx) => {
    await travarColaborador(tx, v.colaboradorId);
    const saldo = await saldoPendente(tx, v.colaboradorId);
    if (v.valorCents > saldo) {
      throw new ErroNegocio("O pagamento é maior que o saldo pendente de comissões.");
    }
    const [p] = await tx
      .insert(comissaoPagamentos)
      .values({ colaboradorId: v.colaboradorId, valorCents: v.valorCents, dataEfetiva: data, observacao: v.observacao ?? null, registradoPor: ator.id })
      .returning();
    await auditar(tx, ator, {
      acao: "pagamento_comissao",
      entidade: "comissao_pagamento",
      entidadeId: p.id,
      antes: { saldoPendente: saldo },
      depois: { ...p, saldoPendente: saldo - v.valorCents },
      dataEfetiva: data,
    });
    return p;
  });
}

/** Extrato de comissões de um colaborador (colaborador só vê o próprio). */
export async function extratoComissoes(db: DB, ator: Ator, colaboradorId: number, periodo?: { de: string; ate: string }) {
  exigirProprioOuAdmin(ator, colaboradorId);
  const condL: SQL[] = [];
  const condP: SQL[] = [];
  if (periodo) {
    condL.push(gte(comissaoLancamentos.dataEfetiva, periodo.de), lte(comissaoLancamentos.dataEfetiva, periodo.ate));
    condP.push(gte(comissaoPagamentos.dataEfetiva, periodo.de), lte(comissaoPagamentos.dataEfetiva, periodo.ate));
  }
  const noPeriodo = await somaLancamentos(db, colaboradorId, condL);
  const pagoNoPeriodo = await somaPagamentos(db, colaboradorId, condP);
  const lancamentos = await db
    .select()
    .from(comissaoLancamentos)
    .where(and(eq(comissaoLancamentos.colaboradorId, colaboradorId), ...condL))
    .orderBy(desc(comissaoLancamentos.dataEfetiva), desc(comissaoLancamentos.id));
  const pagamentos = await db
    .select()
    .from(comissaoPagamentos)
    .where(and(eq(comissaoPagamentos.colaboradorId, colaboradorId), ...condP))
    .orderBy(desc(comissaoPagamentos.dataEfetiva), desc(comissaoPagamentos.id));
  // Saldo pendente ao fim do período (ou atual, sem período).
  const condAteL = periodo ? [lte(comissaoLancamentos.dataEfetiva, periodo.ate)] : [];
  const condAteP = periodo ? [lte(comissaoPagamentos.dataEfetiva, periodo.ate)] : [];
  const ate = await somaLancamentos(db, colaboradorId, condAteL);
  const pagoAte = await somaPagamentos(db, colaboradorId, condAteP);
  return {
    geradoCents: noPeriodo.gerada,
    estornosCents: noPeriodo.estornos,
    ajustesNegativosCents: noPeriodo.ajustes,
    pagoCents: pagoNoPeriodo,
    saldoPendenteCents: ate.gerada + ate.estornos + ate.ajustes - pagoAte,
    lancamentos,
    pagamentos,
  };
}

/** Resumo por colaborador (admins). */
export async function resumoComissoes(db: DB, ator: Ator, periodo?: { de: string; ate: string }) {
  exigirAdmin(ator);
  const pessoas = await db.select({ id: usuarios.id, nome: usuarios.nome, ativo: usuarios.ativo }).from(usuarios).orderBy(asc(usuarios.nome));
  const linhas = [];
  for (const p of pessoas) {
    const e = await extratoComissoes(db, ator, p.id, periodo);
    if (!p.ativo && e.geradoCents === 0 && e.saldoPendenteCents === 0 && e.pagoCents === 0) continue;
    linhas.push({
      colaboradorId: p.id,
      nome: p.nome,
      geradoCents: e.geradoCents,
      estornosCents: e.estornosCents,
      ajustesNegativosCents: e.ajustesNegativosCents,
      pagoCents: e.pagoCents,
      saldoPendenteCents: e.saldoPendenteCents,
    });
  }
  return linhas;
}
