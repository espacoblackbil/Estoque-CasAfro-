import { ErroPermissao } from "../erros";

export type Papel = "principal" | "admin" | "colaborador";

/** Usuário autenticado que executa a operação. Sempre vem da sessão no servidor. */
export interface Ator {
  id: number;
  nome: string;
  papel: Papel;
}

export const ehAdmin = (a: Ator) => a.papel === "admin" || a.papel === "principal";

export function exigirAdmin(a: Ator): void {
  if (!ehAdmin(a)) throw new ErroPermissao();
}

export function exigirPrincipal(a: Ator): void {
  if (a.papel !== "principal") throw new ErroPermissao("Somente o administrador principal pode fazer isto.");
}

/** Colaborador só pode ver dados próprios; admins veem todos. */
export function exigirProprioOuAdmin(a: Ator, usuarioId: number): void {
  if (!ehAdmin(a) && a.id !== usuarioId) throw new ErroPermissao();
}
