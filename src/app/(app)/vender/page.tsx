import { getDb } from "@/server/db";
import { exigirSessao } from "@/server/sessao";
import { listarProdutosAdmin, listarProdutosPublico } from "@/server/services/cadastros";
import { listarVendedores } from "@/server/services/usuarios";
import { ehAdmin } from "@/server/services/permissoes";
import { hoje } from "@/domain/datas";
import { Pdv } from "./Pdv";

export default async function Vender() {
  const ator = await exigirSessao();
  const db = await getDb();
  const [produtos, vendedores] = await Promise.all([listarProdutosPublico(db, ator), listarVendedores(db, ator)]);
  // modalidade só vai ao navegador de administradores (necessária para valores retroativos)
  const modalidades = ehAdmin(ator)
    ? Object.fromEntries((await listarProdutosAdmin(db, ator)).map((p) => [p.id, p.modalidade]))
    : undefined;
  return (
    <>
      <div className="cabecalho-pagina"><h1>Nova venda</h1></div>
      <Pdv produtos={produtos} modalidades={modalidades} vendedores={vendedores} admin={ehAdmin(ator)} atorId={ator.id} hoje={hoje()} />
    </>
  );
}
