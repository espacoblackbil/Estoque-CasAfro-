import { randomBytes } from "node:crypto";
import path from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { conectarPglite, schema, type DB } from "@/server/db";
import { criarPrincipalInicial, criarUsuario } from "@/server/services/usuarios";
import type { Ator } from "@/server/services/permissoes";

export interface Cenario {
  db: DB;
  principal: Ator;
  admin: Ator;
  colab: Ator;
  colab2: Ator;
}

/**
 * Banco PostgreSQL novo com as migrações reais.
 *  - padrão: PGlite (PostgreSQL embutido, em memória) — zero instalação;
 *  - com TEST_DATABASE_URL: cria um banco descartável no servidor PostgreSQL informado
 *    (conexões reais em pool, concorrência real).
 */
async function novoBanco(): Promise<DB> {
  const base = process.env.TEST_DATABASE_URL;
  if (!base) return conectarPglite();
  const nome = `casafro_teste_${randomBytes(5).toString("hex")}`;
  const admin = new Pool({ connectionString: base, max: 1 });
  await admin.query(`create database ${nome}`);
  await admin.end();
  const url = new URL(base);
  url.pathname = `/${nome}`;
  const pool = new Pool({ connectionString: url.toString(), max: 5 });
  const db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  return db as unknown as DB;
}

/** Cenário com banco novo e usuários básicos. */
export async function novoCenario(): Promise<Cenario> {
  const db = await novoBanco();
  const principal = await criarPrincipalInicial(db, { nome: "Dona Principal", login: "principal", senha: "senha123" });
  const admin = await criarUsuario(db, principal, { nome: "Ana Admin", login: "admin", senha: "senha123", papel: "admin" });
  const colab = await criarUsuario(db, principal, { nome: "Carla Colab", login: "carla", senha: "senha123", papel: "colaborador" });
  const colab2 = await criarUsuario(db, principal, { nome: "Bia Colab", login: "bia", senha: "senha123", papel: "colaborador" });
  return { db, principal, admin, colab, colab2 };
}
