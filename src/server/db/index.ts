import path from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import * as schema from "./schema";

export { schema };
export type DB = PgDatabase<PgQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>;

export const PASTA_MIGRACOES = path.join(process.cwd(), "drizzle");

/** Banco PostgreSQL de produção (DATABASE_URL) via node-postgres. */
async function conectarPostgres(url: string): Promise<DB> {
  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const pool = new Pool({ connectionString: url, max: 5 });
  return drizzle(pool, { schema }) as unknown as DB;
}

/** PostgreSQL embutido (PGlite). `dir` vazio = memória (testes). */
export async function conectarPglite(dir?: string): Promise<DB> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const client = dir ? new PGlite(dir) : new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: PASTA_MIGRACOES });
  return db as unknown as DB;
}

const globalRef = globalThis as unknown as { __casafroDb?: Promise<DB> };

/** Conexão única por processo. */
export function getDb(): Promise<DB> {
  if (!globalRef.__casafroDb) {
    const url = process.env.DATABASE_URL;
    if (url) {
      globalRef.__casafroDb = conectarPostgres(url);
    } else if (process.env.NODE_ENV === "production") {
      throw new Error("DATABASE_URL não configurada: produção exige banco persistente.");
    } else {
      globalRef.__casafroDb = conectarPglite(path.join(process.cwd(), ".data", "pglite"));
    }
  }
  return globalRef.__casafroDb;
}
