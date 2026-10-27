import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { getDb } from "./db";
import { ErroNegocio } from "./erros";
import { atorDaSessao } from "./services/usuarios";
import { ehAdmin, type Ator } from "./services/permissoes";

export const COOKIE_SESSAO = "casafro_sessao";

/** Ator da requisição atual (validado no banco), ou null. */
export const obterAtor = cache(async (): Promise<Ator | null> => {
  const token = (await cookies()).get(COOKIE_SESSAO)?.value;
  if (!token) return null;
  return atorDaSessao(await getDb(), token);
});

export async function exigirSessao(): Promise<Ator> {
  const ator = await obterAtor();
  if (!ator) redirect("/login");
  return ator;
}

export async function exigirSessaoAdmin(): Promise<Ator> {
  const ator = await exigirSessao();
  if (!ehAdmin(ator)) redirect("/?erro=" + encodeURIComponent("Acesso restrito a administradores."));
  return ator;
}

export function mensagemDeErro(e: unknown): string | null {
  if (e instanceof ErroNegocio) return e.message;
  if (e instanceof ZodError) return e.issues[0]?.message ?? "Dados inválidos.";
  if (e instanceof Error && /Valor|Percentual|Data/.test(e.message) && e.message.length < 120) return e.message;
  return null;
}

/**
 * Executa uma operação de formulário e redireciona com mensagem de sucesso ou erro.
 * Erros inesperados são registrados e mostrados de forma genérica.
 */
export async function executarAcao<T>(fn: () => Promise<T>, destino: string, sucesso: string | ((r: T) => string)): Promise<never> {
  let url: string;
  try {
    const r = await fn();
    url = comParam(destino, "ok", typeof sucesso === "function" ? sucesso(r) : sucesso);
  } catch (e) {
    const msg = mensagemDeErro(e);
    if (!msg) console.error(e);
    url = comParam(destino, "erro", msg ?? "Não foi possível concluir a operação. Tente novamente.");
  }
  redirect(url);
}

function comParam(destino: string, k: string, v: string) {
  return `${destino}${destino.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(v)}`;
}
