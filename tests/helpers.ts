import { conectarPglite, type DB } from "@/server/db";
import { criarPrincipalInicial, criarUsuario } from "@/server/services/usuarios";
import type { Ator } from "@/server/services/permissoes";

export interface Cenario {
  db: DB;
  principal: Ator;
  admin: Ator;
  colab: Ator;
  colab2: Ator;
}

/** Banco PostgreSQL novo (PGlite em memória, migrações reais) com usuários básicos. */
export async function novoCenario(): Promise<Cenario> {
  const db = await conectarPglite();
  const principal = await criarPrincipalInicial(db, { nome: "Dona Principal", login: "principal", senha: "senha123" });
  const admin = await criarUsuario(db, principal, { nome: "Ana Admin", login: "admin", senha: "senha123", papel: "admin" });
  const colab = await criarUsuario(db, principal, { nome: "Carla Colab", login: "carla", senha: "senha123", papel: "colaborador" });
  const colab2 = await criarUsuario(db, principal, { nome: "Bia Colab", login: "bia", senha: "senha123", papel: "colaborador" });
  return { db, principal, admin, colab, colab2 };
}
