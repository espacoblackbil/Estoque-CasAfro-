import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db";
import { sessoes, usuarios } from "../db/schema";
import { ErroNegocio, ErroPermissao } from "../erros";
import { auditar } from "./auditoria";
import { ehAdmin, exigirAdmin, type Ator, type Papel } from "./permissoes";

const CUSTO_BCRYPT = 10;
const DURACAO_SESSAO_MS = 1000 * 60 * 60 * 24 * 30; // 30 dias

export const hashSenha = (senha: string) => bcrypt.hash(senha, CUSTO_BCRYPT);
const HASH_FICTICIO = bcrypt.hashSync("senha-ficticia", CUSTO_BCRYPT);
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

const esquemaUsuario = z.object({
  nome: z.string().trim().min(2, "Informe o nome"),
  login: z.string().trim().min(3, "Login com ao menos 3 caracteres").max(40).regex(/^[a-zA-Z0-9._-]+$/, "Login: use letras, números, ponto, hífen ou sublinhado"),
  senha: z.string().min(6, "Senha com ao menos 6 caracteres").max(200),
  papel: z.enum(["principal", "admin", "colaborador"]),
});

/** Quem pode gerenciar contas de qual papel (spec §3). */
function podeGerenciar(ator: Ator, papelAlvo: Papel): boolean {
  if (ator.papel === "principal") return papelAlvo !== "principal";
  if (ator.papel === "admin") return papelAlvo === "colaborador";
  return false;
}

async function existeUsuario(db: DB): Promise<boolean> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(usuarios);
  return r.n > 0;
}

/** Cria o administrador principal — somente quando ainda não existe nenhum usuário. */
export async function criarPrincipalInicial(db: DB, dados: { nome: string; login: string; senha: string }) {
  const v = esquemaUsuario.parse({ ...dados, papel: "principal" });
  return db.transaction(async (tx) => {
    await tx.execute(sql`lock table usuarios in exclusive mode`);
    if (await existeUsuario(tx)) throw new ErroNegocio("O sistema já foi configurado.");
    const [u] = await tx
      .insert(usuarios)
      .values({ nome: v.nome, login: v.login, senhaHash: await hashSenha(v.senha), papel: "principal" })
      .returning({ id: usuarios.id, nome: usuarios.nome, papel: usuarios.papel });
    await auditar(tx, u, { acao: "criar_principal", entidade: "usuario", entidadeId: u.id, depois: { nome: v.nome, login: v.login } });
    return u;
  });
}

export async function sistemaConfigurado(db: DB) {
  return existeUsuario(db);
}

export async function criarUsuario(db: DB, ator: Ator, dados: z.input<typeof esquemaUsuario>) {
  const v = esquemaUsuario.parse(dados);
  if (!podeGerenciar(ator, v.papel)) throw new ErroPermissao("Você não pode criar contas com este perfil.");
  return db.transaction(async (tx) => {
    const [dup] = await tx.select({ id: usuarios.id }).from(usuarios).where(sql`lower(${usuarios.login}) = lower(${v.login})`);
    if (dup) throw new ErroNegocio("Já existe um usuário com este login.");
    const [u] = await tx
      .insert(usuarios)
      .values({ nome: v.nome, login: v.login, senhaHash: await hashSenha(v.senha), papel: v.papel })
      .returning({ id: usuarios.id, nome: usuarios.nome, login: usuarios.login, papel: usuarios.papel });
    await auditar(tx, ator, { acao: "criar_usuario", entidade: "usuario", entidadeId: u.id, depois: { nome: u.nome, login: u.login, papel: u.papel } });
    return u;
  });
}

const esquemaEdicao = z.object({
  nome: z.string().trim().min(2).optional(),
  papel: z.enum(["principal", "admin", "colaborador"]).optional(),
  ativo: z.boolean().optional(),
  novaSenha: z.string().min(6).max(200).optional(),
});

export async function editarUsuario(db: DB, ator: Ator, id: number, dados: z.input<typeof esquemaEdicao>, justificativa?: string) {
  const v = esquemaEdicao.parse(dados);
  return db.transaction(async (tx) => {
    const [alvo] = await tx.select().from(usuarios).where(eq(usuarios.id, id));
    if (!alvo) throw new ErroNegocio("Usuário não encontrado.");
    const ehProprio = alvo.id === ator.id;
    // Qualquer usuário pode trocar a própria senha; o resto exige permissão sobre o papel atual e o novo.
    const soSenhaPropria = ehProprio && v.nome === undefined && v.papel === undefined && v.ativo === undefined;
    if (!soSenhaPropria) {
      if (!podeGerenciar(ator, alvo.papel) || (v.papel && !podeGerenciar(ator, v.papel))) {
        throw new ErroPermissao("Você não pode alterar esta conta.");
      }
    }
    const mudancas: Partial<typeof usuarios.$inferInsert> = {};
    if (v.nome !== undefined) mudancas.nome = v.nome;
    if (v.papel !== undefined) mudancas.papel = v.papel;
    if (v.ativo !== undefined) mudancas.ativo = v.ativo;
    if (v.novaSenha) mudancas.senhaHash = await hashSenha(v.novaSenha);
    if (Object.keys(mudancas).length === 0) return;
    await tx.update(usuarios).set(mudancas).where(eq(usuarios.id, id));
    if (v.ativo === false || v.novaSenha) await tx.delete(sessoes).where(eq(sessoes.usuarioId, id));
    await auditar(tx, ator, {
      acao: "editar_usuario",
      entidade: "usuario",
      entidadeId: id,
      antes: { nome: alvo.nome, papel: alvo.papel, ativo: alvo.ativo },
      depois: { nome: v.nome ?? alvo.nome, papel: v.papel ?? alvo.papel, ativo: v.ativo ?? alvo.ativo, senhaAlterada: !!v.novaSenha },
      justificativa,
    });
  });
}

/** Lista para administração (admins) — colaborador vê apenas a si mesmo. */
export async function listarUsuarios(db: DB, ator: Ator) {
  const base = db
    .select({ id: usuarios.id, nome: usuarios.nome, login: usuarios.login, papel: usuarios.papel, ativo: usuarios.ativo })
    .from(usuarios);
  if (!ehAdmin(ator)) return base.where(eq(usuarios.id, ator.id));
  return base.orderBy(asc(usuarios.nome));
}

/** Usuários que podem ser responsáveis por vendas (todos os ativos). */
export async function listarVendedores(db: DB, ator: Ator) {
  const base = db.select({ id: usuarios.id, nome: usuarios.nome }).from(usuarios);
  if (!ehAdmin(ator)) return base.where(eq(usuarios.id, ator.id));
  return base.where(eq(usuarios.ativo, true)).orderBy(asc(usuarios.nome));
}

/** Verifica credenciais sem criar sessão. Retorna o ator ou null. */
export async function verificarCredenciais(db: DB, login: string, senha: string): Promise<Ator | null> {
  const [u] = await db.select().from(usuarios).where(sql`lower(${usuarios.login}) = lower(${login.trim()})`);
  // compara mesmo sem usuário para não revelar logins existentes pelo tempo de resposta
  const ok = await bcrypt.compare(senha, u?.senhaHash ?? HASH_FICTICIO);
  if (!u || !ok || !u.ativo) return null;
  return { id: u.id, nome: u.nome, papel: u.papel };
}

export async function entrar(db: DB, login: string, senha: string) {
  const ator = await verificarCredenciais(db, login, senha);
  if (!ator) throw new ErroNegocio("Login ou senha incorretos.");
  const token = randomBytes(32).toString("base64url");
  const expiraEm = new Date(Date.now() + DURACAO_SESSAO_MS);
  await db.insert(sessoes).values({ id: hashToken(token), usuarioId: ator.id, expiraEm });
  return { token, expiraEm, ator };
}

export async function atorDaSessao(db: DB, token: string | undefined): Promise<Ator | null> {
  if (!token) return null;
  const [r] = await db
    .select({ id: usuarios.id, nome: usuarios.nome, papel: usuarios.papel, ativo: usuarios.ativo })
    .from(sessoes)
    .innerJoin(usuarios, eq(usuarios.id, sessoes.usuarioId))
    .where(and(eq(sessoes.id, hashToken(token)), gt(sessoes.expiraEm, new Date())));
  if (!r || !r.ativo) return null;
  return { id: r.id, nome: r.nome, papel: r.papel };
}

export async function sair(db: DB, token: string) {
  await db.delete(sessoes).where(eq(sessoes.id, hashToken(token)));
}

/** Exige que um admin autorize uma ação informando login e senha (ex.: margem negativa). */
export async function autorizacaoAdmin(db: DB, login: string, senha: string): Promise<Ator> {
  const a = await verificarCredenciais(db, login, senha);
  if (!a || !ehAdmin(a)) throw new ErroPermissao("Autorização de administrador inválida.");
  return a;
}

export { exigirAdmin };

/** Troca da própria senha, exigindo a senha atual. */
export async function alterarPropriaSenha(db: DB, ator: Ator, atual: string, nova: string) {
  const [u] = await db.select({ login: usuarios.login }).from(usuarios).where(eq(usuarios.id, ator.id));
  if (!u || !(await verificarCredenciais(db, u.login, atual))) throw new ErroNegocio("Senha atual incorreta.");
  await editarUsuario(db, ator, ator.id, { novaSenha: nova });
}
