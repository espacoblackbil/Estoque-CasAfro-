"use server";
import { getDb } from "@/server/db";
import { dadosAlterados, exigirSessao, mensagemDeErro } from "@/server/sessao";
import { ErroMargemNegativa, registrarVenda, type EntradaVenda } from "@/server/services/vendas";
import { registrarUsoSalao } from "@/server/services/estoque";

export type RespostaVenda =
  | { ok: true; vendaId: number; duplicada: boolean }
  | { ok: false; erro: string; margemNegativa?: { nome: string }[] };

export async function acaoRegistrarVenda(dados: EntradaVenda): Promise<RespostaVenda> {
  const ator = await exigirSessao();
  try {
    const r = await registrarVenda(await getDb(), ator, dados);
    dadosAlterados();
    return { ok: true, vendaId: r.venda.id, duplicada: r.duplicada };
  } catch (e) {
    if (e instanceof ErroMargemNegativa) return { ok: false, erro: e.message, margemNegativa: e.itens.map((i) => ({ nome: i.nome })) };
    const msg = mensagemDeErro(e);
    if (!msg) console.error(e);
    return { ok: false, erro: msg ?? "Falha ao registrar. Verifique a conexão e tente de novo — a venda não será duplicada." };
  }
}

export type RespostaUsoSalao = { ok: true; retiradaId: number; unidades: number; duplicada: boolean } | { ok: false; erro: string };

export async function acaoRegistrarUsoSalao(dados: Parameters<typeof registrarUsoSalao>[2]): Promise<RespostaUsoSalao> {
  const ator = await exigirSessao();
  try {
    const r = await registrarUsoSalao(await getDb(), ator, dados);
    dadosAlterados();
    return { ok: true, retiradaId: r.retirada.id, unidades: r.unidades, duplicada: r.duplicada };
  } catch (e) {
    const msg = mensagemDeErro(e);
    if (!msg) console.error(e);
    return { ok: false, erro: msg ?? "Falha ao registrar. Verifique a conexão e tente de novo — a retirada não será duplicada." };
  }
}
