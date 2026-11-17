import Link from "next/link";
import { getDb } from "@/server/db";
import { exigirSessao } from "@/server/sessao";
import { listarVendas } from "@/server/services/vendas";
import { listarVendedores } from "@/server/services/usuarios";
import { ehAdmin } from "@/server/services/permissoes";
import { formatarBRL as R } from "@/domain/money";
import { formatarData, hoje, intervaloDoMes } from "@/domain/datas";
import { Mensagens, lerParams, type BuscaParams } from "@/components/Mensagens";

const SITUACAO: Record<string, [string, string]> = { ativa: ["Ativa", "verde"], cancelada: ["Cancelada", "rosa"], devolvida_parcial: ["Devolução parcial", "amarelo"] };

export default async function Vendas({ searchParams }: { searchParams: BuscaParams }) {
  const ator = await exigirSessao();
  const db = await getDb();
  const { s, ok, erro } = await lerParams(searchParams);
  const [iniMes, fimMes] = intervaloDoMes(hoje().slice(0, 7));
  const de = s("de") ?? iniMes;
  const ate = s("ate") ?? fimMes;
  const colaboradorId = s("colaborador") ? Number(s("colaborador")) : undefined;
  const admin = ehAdmin(ator);
  const [lista, vendedores] = await Promise.all([listarVendas(db, ator, { de, ate, colaboradorId }), admin ? listarVendedores(db, ator) : []]);
  const validas = lista.filter((v) => v.situacao !== "cancelada");
  return (
    <>
      <Mensagens ok={ok} erro={erro} />
      <div className="cabecalho-pagina">
        <div><h1>{admin ? "Vendas" : "Minhas vendas"}</h1><p className="suave">{lista.length} venda(s) · {R(validas.reduce((a, v) => a + v.liquidoCents, 0))}</p></div>
        <Link className="btn amarelo" href="/vender">＋ Nova venda</Link>
      </div>
      <form className="cartao linha-campos" method="get">
        <div className="campo"><label>De</label><input type="date" name="de" defaultValue={de} /></div>
        <div className="campo"><label>Até</label><input type="date" name="ate" defaultValue={ate} /></div>
        {admin && (
          <div className="campo"><label>Colaborador</label>
            <select name="colaborador" defaultValue={colaboradorId ?? ""}><option value="">Todos</option>{vendedores.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}</select>
          </div>
        )}
        <div className="campo" style={{ alignSelf: "end" }}><button className="btn bloco">Filtrar</button></div>
      </form>
      <div className="cartao tabela-wrap">
        <table>
          <thead><tr><th>#</th><th>Data</th><th>Colaborador</th><th>Cliente</th><th>Situação</th><th className="num">Desconto</th><th className="num">Total</th></tr></thead>
          <tbody>
            {lista.map((v) => (
              <tr key={v.id}>
                <td><Link href={`/vendas/${v.id}`}>#{v.id}</Link></td>
                <td>{formatarData(v.dataEfetiva)}</td>
                <td>{v.colaborador}</td>
                <td>{v.cliente ?? "—"}</td>
                <td><span className={`selo ${SITUACAO[v.situacao]?.[1]}`}>{SITUACAO[v.situacao]?.[0] ?? v.situacao}</span> {v.estoqueNegativo && <span className="selo rosa">estoque negativo</span>}</td>
                <td className="num">{v.descontoCents ? R(v.descontoCents) : "—"}</td>
                <td className="num"><strong>{R(v.liquidoCents)}</strong></td>
              </tr>
            ))}
            {lista.length === 0 && <tr><td colSpan={7} className="suave">Nenhuma venda no período.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
