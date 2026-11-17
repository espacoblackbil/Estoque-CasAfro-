/**
 * Cria o administrador principal pelo terminal (alternativa à tela /setup).
 * Uso: DATABASE_URL=... npm run criar-admin -- "Nome Completo" login senha
 */
import { getDb } from "../src/server/db";
import { criarPrincipalInicial } from "../src/server/services/usuarios";

async function main() {
  const [nome, login, senha] = process.argv.slice(2);
  if (!nome || !login || !senha) throw new Error('Uso: npm run criar-admin -- "Nome" login senha');
  const u = await criarPrincipalInicial(await getDb(), { nome, login, senha });
  console.log(`Administrador principal criado: ${u.nome} (id ${u.id}).`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
