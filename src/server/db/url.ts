/**
 * Endereço do banco. `NEON_URL` (criado pela integração Neon da Vercel com o prefixo "NEON")
 * tem prioridade; `DATABASE_URL` é o nome padrão para configuração manual.
 */
export function urlDoBanco(): string | undefined {
  return process.env.NEON_URL || process.env.DATABASE_URL || undefined;
}
