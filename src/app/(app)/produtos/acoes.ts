"use server";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db";
import { exigirSessaoAdmin, mensagemDeErro } from "@/server/sessao";
import { criarProduto, editarProduto } from "@/server/services/cadastros";
import { justificativaDoForm, produtoDoForm } from "./dados";

export type EstadoProduto = { erro?: string } | null;

/** Cria ou edita um produto. Em caso de erro, devolve a mensagem sem sair do formulário. */
export async function acaoSalvarProduto(_anterior: EstadoProduto, fd: FormData): Promise<EstadoProduto> {
  const ator = await exigirSessaoAdmin();
  const db = await getDb();
  const id = fd.get("id") ? Number(fd.get("id")) : undefined;
  let destino: string;
  try {
    const dados = produtoDoForm(fd);
    if (id) {
      await editarProduto(db, ator, id, dados, justificativaDoForm(fd));
      destino = `/produtos/${id}?ok=${encodeURIComponent("Produto atualizado.")}`;
    } else {
      const p = await criarProduto(db, ator, dados);
      destino = `/produtos/${p.id}?ok=${encodeURIComponent("Produto cadastrado. Agora registre a entrada ou o saldo inicial em Estoque.")}`;
    }
  } catch (e) {
    const msg = mensagemDeErro(e);
    if (!msg) console.error(e);
    return { erro: msg ?? "Não foi possível salvar. Tente novamente." };
  }
  redirect(destino);
}
