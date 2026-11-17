import { eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db";
import { configuracoes } from "../db/schema";
import { ErroNegocio } from "../erros";
import { auditar } from "./auditoria";
import { exigirAdmin, type Ator } from "./permissoes";

export async function obterConfiguracoes(db: DB) {
  const [c] = await db.select().from(configuracoes).where(eq(configuracoes.id, 1));
  if (c) return c;
  const [novo] = await db.insert(configuracoes).values({ id: 1 }).onConflictDoNothing().returning();
  return novo ?? (await db.select().from(configuracoes).where(eq(configuracoes.id, 1)))[0];
}

const esquema = z.object({
  nomeFantasia: z.string().trim().min(1).max(120),
  razaoSocial: z.string().trim().max(200),
  cnpj: z.string().trim().max(20),
  endereco: z.string().trim().max(300),
  telefone: z.string().trim().max(40),
  estoqueMinimo: z.number().int().min(0).max(100000),
  logotipo: z
    .string()
    .max(1_500_000, "Logotipo muito grande (máx. ~1 MB)")
    .refine((s) => s === "" || /^data:image\/(png|jpeg);base64,/.test(s), "Logotipo deve ser PNG ou JPEG")
    .optional(),
});

export async function salvarConfiguracoes(db: DB, ator: Ator, dados: z.input<typeof esquema>) {
  exigirAdmin(ator);
  const v = esquema.parse(dados);
  return db.transaction(async (tx) => {
    const antes = await obterConfiguracoes(tx);
    if (!antes) throw new ErroNegocio("Configurações indisponíveis.");
    const novo = { ...v, logotipo: v.logotipo ?? antes.logotipo, atualizadoEm: new Date() };
    await tx.update(configuracoes).set(novo).where(eq(configuracoes.id, 1));
    const resumo = (c: typeof antes | typeof novo) => ({ ...c, logotipo: c.logotipo ? `(imagem ${c.logotipo.length} bytes)` : "" });
    await auditar(tx, ator, { acao: "editar_configuracoes", entidade: "configuracoes", entidadeId: 1, antes: resumo(antes), depois: resumo(novo) });
  });
}
