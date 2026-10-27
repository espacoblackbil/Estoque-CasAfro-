import { getDb } from "@/server/db";
import { exigirSessao } from "@/server/sessao";
import { listarProdutosPublico } from "@/server/services/cadastros";
import { listarVendedores } from "@/server/services/usuarios";
import { ehAdmin } from "@/server/services/permissoes";
import { hoje } from "@/domain/datas";
import { Pdv } from "./Pdv";

export default async function Vender() {
  const ator = await exigirSessao();
  const db = await getDb();
  const [produtos, vendedores] = await Promise.all([listarProdutosPublico(db, ator), listarVendedores(db, ator)]);
  return (
    <>
      <div className="cabecalho-pagina"><h1>Nova venda</h1></div>
      <Pdv produtos={produtos} vendedores={vendedores} admin={ehAdmin(ator)} atorId={ator.id} hoje={hoje()} />
    </>
  );
}
