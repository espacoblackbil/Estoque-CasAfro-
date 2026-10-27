import Link from "next/link";
import { getDb } from "@/server/db";
import { exigirSessao } from "@/server/sessao";
import { listarProdutosAdmin, listarProdutosPublico } from "@/server/services/cadastros";
import { ehAdmin } from "@/server/services/permissoes";
import { formatarBRL as R, formatarPercentual } from "@/domain/money";
import { Mensagens, lerParams, type BuscaParams } from "@/components/Mensagens";

export default async function Produtos({ searchParams }: { searchParams: BuscaParams }) {
  const ator = await exigirSessao();
  const db = await getDb();
  const { s, ok, erro } = await lerParams(searchParams);
  const busca = s("q");
  const inativos = s("inativos") === "1";
  const busc = (
    <form method="get" className="cartao acoes">
      <input name="q" defaultValue={busca} placeholder="Buscar pelo nome…" style={{ flex: "1 1 200px" }} />
      {ehAdmin(ator) && <label className="check"><input type="checkbox" name="inativos" value="1" defaultChecked={inativos} /> inativos</label>}
      <button className="btn">Buscar</button>
    </form>
  );

  if (!ehAdmin(ator)) {
    const lista = await listarProdutosPublico(db, ator, busca);
    return (
      <>
        <div className="cabecalho-pagina"><h1>Produtos</h1></div>
        {busc}
        <section className="cartao">
          <ul className="lista">
            {lista.map((p) => (
              <li key={p.id}><span><span className="principal">{p.nome}</span><br /><small>{p.categoria ?? "Sem categoria"}</small></span>
                <span style={{ textAlign: "right" }}><strong className="num">{R(p.precoVendaCents)}</strong><br /><span className={`selo ${p.quantidade <= 0 ? "rosa" : p.estoqueBaixo ? "amarelo" : "verde"}`}>{p.quantidade} disponível</span></span></li>
            ))}
          </ul>
        </section>
      </>
    );
  }

  const lista = await listarProdutosAdmin(db, ator, { busca, incluirInativos: inativos });
  return (
    <>
      <Mensagens ok={ok} erro={erro} />
      <div className="cabecalho-pagina">
        <div><h1>Produtos</h1><p className="suave">{lista.length} produto(s)</p></div>
        <Link className="btn primario" href="/produtos/novo">＋ Novo produto</Link>
      </div>
      {busc}
      <section className="cartao tabela-wrap">
        <table>
          <thead><tr><th>Produto</th><th>Modalidade</th><th className="num">Estoque</th><th className="num">Preço</th><th className="num">Custo/repasse</th><th className="num">Comissão</th></tr></thead>
          <tbody>
            {lista.map((p) => (
              <tr key={p.id}>
                <td><Link href={`/produtos/${p.id}`}><strong>{p.nome}</strong></Link><br /><small>{[p.categoria, p.fornecedor].filter(Boolean).join(" · ") || "—"}</small>{!p.ativo && <> <span className="selo">inativo</span></>}</td>
                <td><span className={`selo ${p.modalidade === "consignado" ? "amarelo" : "verde"}`}>{p.modalidade === "consignado" ? "Consignado" : "Próprio"}</span></td>
                <td className="num"><span className={`selo ${p.quantidade < 0 ? "rosa" : p.estoqueBaixo ? "amarelo" : ""}`}>{p.quantidade}</span>{p.pendenteQtd > 0 && <><br /><small>{p.pendenteQtd} c/ custo estimado</small></>}</td>
                <td className="num">{R(p.precoVendaCents)}</td>
                <td className="num">{R(p.modalidade === "proprio" ? p.custoMedioCents : p.repasseCents)}</td>
                <td className="num">{formatarPercentual(p.comissaoBps)}</td>
              </tr>
            ))}
            {lista.length === 0 && <tr><td colSpan={6} className="suave">Nenhum produto encontrado.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}
