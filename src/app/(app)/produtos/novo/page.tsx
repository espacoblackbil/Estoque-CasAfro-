import { getDb } from "@/server/db";
import { exigirSessaoAdmin } from "@/server/sessao";
import { listarCategorias, listarFornecedores } from "@/server/services/cadastros";
import { ProdutoForm } from "@/components/ProdutoForm";

export default async function NovoProduto() {
  const ator = await exigirSessaoAdmin();
  const db = await getDb();
  const [categorias, fornecedores] = await Promise.all([listarCategorias(db), listarFornecedores(db, ator)]);
  return (
    <>
      <div className="cabecalho-pagina"><h1>Novo produto</h1></div>
      <ProdutoForm categorias={categorias.filter((c) => c.ativo)} fornecedores={fornecedores.filter((f) => f.ativo)} />
    </>
  );
}
