/** Aplica as migrações pendentes no banco de DATABASE_URL. Uso: npm run db:migrate */
import { urlDoBanco } from "../src/server/db/url";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";

async function main() {
  const url = urlDoBanco();
  if (!url) {
    // no build sem banco (ex.: CI de tipos), apenas segue
    if (process.argv.includes("--se-configurado")) return console.log("DATABASE_URL ausente: migrações não aplicadas.");
    throw new Error("Defina DATABASE_URL.");
  }
  const pool = new Pool({ connectionString: url, max: 1 });
  await migrate(drizzle(pool), { migrationsFolder: path.join(process.cwd(), "drizzle") });
  await pool.end();
  console.log("Migrações aplicadas.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
