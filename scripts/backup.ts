/**
 * Backup lógico completo do banco (pg_dump, formato custom) em ./backups.
 * Uso: DATABASE_URL=... npm run backup
 * Restauração: pg_restore --clean --if-exists -d "$DATABASE_URL" backups/arquivo.dump
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Defina DATABASE_URL.");
  process.exit(1);
}
const pasta = path.join(process.cwd(), "backups");
fs.mkdirSync(pasta, { recursive: true });
const carimbo = new Date().toISOString().replace(/[:.]/g, "-");
const arquivo = path.join(pasta, `casafro-${carimbo}.dump`);
execFileSync("pg_dump", ["--format=custom", "--no-owner", "--file", arquivo, url], { stdio: "inherit" });
console.log(`Backup gravado em ${arquivo} (${(fs.statSync(arquivo).size / 1024).toFixed(0)} KB).`);
