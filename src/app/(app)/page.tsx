import Link from "next/link";
import { getDb } from "@/server/db";
import { exigirSessao } from "@/server/sessao";
import { ehAdmin } from "@/server/services/permissoes";
import { dashboard } from "@/server/services/financeiro";
import { listarVendas } from "@/server/services/vendas";
import { extratoComissoes } from "@/server/services/comissoes";
import { formatarBRL as R } from "@/domain/money";
import { hoje, intervaloDoMes, formatarDataHora } from "@/domain/datas";
import { Mensagens, lerParams, type BuscaParams } from "@/components/Mensagens";

export default async function Inicio({ searchParams }: { searchParams: BuscaParams }) {
  const ator = await exigirSessao();
  const db = await getDb();
  const { ok, erro } = await lerParams(searchParams);

  if (!ehAdmin(ator)) {
    const dia = hoje();
    const [de, ate] = intervaloDoMes(dia.slice(0, 7));
    const vendasMes = await listarVendas(db, ator, { de, ate });
    const doDia = vendasMes.filter((v) => v.dataEfetiva === dia && v.situacao !== "cancelada");
    const com = await extratoComissoes(db, ator, ator.id);
    return (
      <>
        <Mensagens ok={ok} erro={erro} />
        <div className="cabecalho-pagina"><div><h1>Olá, {ator.nome.split(" ")[0]}!</h1><p className="suave">Bom trabalho hoje.</p></div></div>
        <Link href="/vender" className="btn amarelo bloco" style={{ marginBottom: 16, minHeight: 56, fontSize: "1.1rem" }}>＋ Registrar nova venda</Link>
        <div className="grade">
          <div className="kpi verde"><div className="rotulo">Minhas vendas hoje</div><div className="valor">{R(doDia.reduce((a, v) => a + v.liquidoCents, 0))}</div><div className="detalhe">{doDia.length} venda(s)</div></div>
          <div className="kpi"><div className="rotulo">Minhas vendas no mês</div><div className="valor">{R(vendasMes.filter((v) => v.situacao !== "cancelada").reduce((a, v) => a + v.liquidoCents, 0))}</div></div>
          <div className="kpi amarelo"><div className="rotulo">Comissão pendente</div><div className="valor">{R(com.saldoPendenteCents)}</div><div className="detalhe"><Link href="/comissoes">ver extrato</Link></div></div>
        </div>
      </>
    );
  }

  const d = await dashboard(db, ator);
  return (
    <>
      <Mensagens ok={ok} erro={erro} />
      <div className="cabecalho-pagina">
        <div><h1>Painel</h1><p className="suave">Indicadores calculados agora a partir dos registros.</p></div>
        <Link href="/vender" className="btn amarelo">＋ Nova venda</Link>
      </div>
      <div className="grade">
        <div className="kpi verde"><div className="rotulo">Faturamento do dia</div><div className="valor">{R(d.faturamentoDia.liquidoCents)}</div><div className="detalhe">{d.faturamentoDia.vendas} venda(s) · bruto {R(d.faturamentoDia.brutoCents)}</div></div>
        <div className="kpi"><div className="rotulo">Faturamento do mês</div><div className="valor">{R(d.faturamentoMes.liquidoCents)}</div><div className="detalhe">{d.faturamentoMes.vendas} venda(s) · bruto {R(d.faturamentoMes.brutoCents)}</div></div>
        <div className={`kpi ${d.resultadoMesCents >= 0 ? "amarelo" : "rosa"}`}><div className="rotulo">Resultado estimado do mês</div><div className="valor">{R(d.resultadoMesCents)}</div><div className="detalhe">operação com produtos</div></div>
      </div>
      <div className="grade-2">
        <section className="cartao">
          <h2>Estoque baixo <span className="selo">mínimo {d.estoqueMinimo}</span></h2>
          {d.estoqueBaixo.length === 0 ? <p className="suave">Nenhum produto abaixo do mínimo.</p> : (
            <ul className="lista">
              {d.estoqueBaixo.slice(0, 12).map((p) => (
                <li key={p.id}><Link href={`/produtos/${p.id}`}>{p.nome}</Link><span className={`selo ${p.quantidade < 0 ? "rosa" : "amarelo"}`}>{p.quantidade} un</span></li>
              ))}
            </ul>
          )}
        </section>
        <section className="cartao">
          <h2>Mais vendidos no mês</h2>
          {d.rankingProdutos.length === 0 ? <p className="suave">Sem vendas no mês.</p> : (
            <ol style={{ margin: 0, paddingLeft: 20 }}>
              {d.rankingProdutos.map((p) => <li key={p.produtoId} style={{ padding: "4px 0" }}>{p.nome} — <strong>{p.quantidade}</strong> un · {R(p.liquidoCents)}</li>)}
            </ol>
          )}
        </section>
        <section className="cartao">
          <h2>Colaboradores no mês</h2>
          {d.rankingColaboradores.length === 0 ? <p className="suave">Sem vendas no mês.</p> : (
            <div className="tabela-wrap"><table>
              <thead><tr><th>#</th><th>Colaborador</th><th className="num">Vendas</th><th className="num">Total</th></tr></thead>
              <tbody>{d.rankingColaboradores.map((c, i) => <tr key={c.colaboradorId}><td>{i + 1}</td><td>{c.nome}</td><td className="num">{c.vendas}</td><td className="num">{R(c.liquidoCents)}</td></tr>)}</tbody>
            </table></div>
          )}
        </section>
        <section className="cartao">
          <h2>Resultado do mês</h2>
          <div className="tabela-wrap"><table><tbody>
            <tr><td>Receita líquida</td><td className="num">{R(d.resultadoMes.receitaLiquidaCents)}</td></tr>
            <tr><td>Custo próprios vendidos</td><td className="num">−{R(d.resultadoMes.cmvProprioCents)}</td></tr>
            <tr><td>Repasses consignados</td><td className="num">−{R(d.resultadoMes.repassesVendidosCents)}</td></tr>
            <tr><td>Comissões</td><td className="num">−{R(d.resultadoMes.comissoesCents)}</td></tr>
            <tr><td>Consumo interno</td><td className="num">−{R(d.resultadoMes.consumoInternoCents)}</td></tr>
            <tr><td>Perdas e danos</td><td className="num">−{R(d.resultadoMes.perdasDanosCents)}</td></tr>
          </tbody><tfoot><tr><td>Resultado estimado</td><td className="num">{R(d.resultadoMesCents)}</td></tr></tfoot></table></div>
          <p className="suave" style={{ marginTop: 8, fontSize: "0.8rem" }}>Não é o lucro líquido do salão: despesas gerais não estão incluídas.</p>
        </section>
      </div>
      <section className="cartao">
        <h2>Últimas vendas</h2>
        <ul className="lista">
          {d.ultimasVendas.map((v) => (
            <li key={v.id}><Link href={`/vendas/${v.id}`}>#{v.id} · {v.colaborador}</Link><span className="suave">{formatarDataHora(v.criadoEm)}</span><strong className="num">{R(v.liquidoCents)}</strong></li>
          ))}
        </ul>
      </section>
    </>
  );
}
