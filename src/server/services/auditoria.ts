import { and, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import type { DB } from "../db";
import { auditoria, usuarios } from "../db/schema";
import { exigirAdmin, type Ator } from "./permissoes";

export interface RegistroAuditoria {
  acao: string;
  entidade: string;
  entidadeId?: string | number | null;
  antes?: unknown;
  depois?: unknown;
  justificativa?: string | null;
  dataEfetiva?: string | null;
}

/** Grava trilha de auditoria (append-only; o banco impede UPDATE/DELETE). */
export async function auditar(tx: DB, ator: Ator | null, r: RegistroAuditoria): Promise<void> {
  await tx.insert(auditoria).values({
    usuarioId: ator?.id ?? null,
    acao: r.acao,
    entidade: r.entidade,
    entidadeId: r.entidadeId == null ? null : String(r.entidadeId),
    antes: r.antes === undefined ? null : JSON.parse(JSON.stringify(r.antes)),
    depois: r.depois === undefined ? null : JSON.parse(JSON.stringify(r.depois)),
    justificativa: r.justificativa ?? null,
    dataEfetiva: r.dataEfetiva ?? null,
  });
}

export async function listarAuditoria(
  db: DB,
  ator: Ator,
  filtro: { entidade?: string; de?: string; ate?: string; limite?: number } = {},
) {
  exigirAdmin(ator);
  const conds: SQL[] = [];
  if (filtro.entidade) conds.push(eq(auditoria.entidade, filtro.entidade));
  if (filtro.de) conds.push(gte(auditoria.criadoEm, new Date(filtro.de + "T00:00:00-03:00")));
  if (filtro.ate) conds.push(lte(auditoria.criadoEm, new Date(filtro.ate + "T23:59:59.999-03:00")));
  return db
    .select({
      id: auditoria.id,
      acao: auditoria.acao,
      entidade: auditoria.entidade,
      entidadeId: auditoria.entidadeId,
      antes: auditoria.antes,
      depois: auditoria.depois,
      justificativa: auditoria.justificativa,
      dataEfetiva: auditoria.dataEfetiva,
      criadoEm: auditoria.criadoEm,
      usuario: usuarios.nome,
    })
    .from(auditoria)
    .leftJoin(usuarios, eq(usuarios.id, auditoria.usuarioId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(auditoria.id))
    .limit(filtro.limite ?? 200);
}
