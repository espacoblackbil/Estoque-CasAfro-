import { getDb } from "@/server/db";
import { executarAcao, exigirSessaoAdmin } from "@/server/sessao";
import { criarProduto, listarCategorias, listarFornecedores } from "@/server/services/cadastros";
import { ProdutoForm } from "@/components/ProdutoForm";
import { Mensagens, lerParams, type BuscaParams } from "@/components/Mensagens";
import { produtoDoForm } from "../dados";

async function acaoCriar(fd: FormData) {
  "use server";
  const ator = await exigirSessaoAdmin();
  const db = await getDb();
  await executarAcao(() => criarProduto(db, ator, produtoDoForm(fd)), "/produtos", "Produto cadastrado. Registre a entrada ou o saldo inicial em Estoque.");
}

export default async function NovoProduto({ searchParams }: { searchParams: BuscaParams }) {
  const ator = await exigirSessaoAdmin();
  const db = await getDb();
  const { erro } = await lerParams(searchParams);
  const [categorias, fornecedores] = await Promise.all([listarCategorias(db), listarFornecedores(db, ator)]);
  return (
    <>
      <div className="cabecalho-pagina"><h1>Novo produto</h1></div>
      <Mensagens erro={erro} />
      <ProdutoForm acao={acaoCriar} categorias={categorias.filter((c) => c.ativo)} fornecedores={fornecedores.filter((f) => f.ativo)} />
    </>
  );
}
