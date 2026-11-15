import Link from "next/link";
import { getDb } from "@/server/db";
import { exigirSessaoPrincipal, mensagemDeErro } from "@/server/sessao";
import { demonstrativoReposicao, type Agrupamento, type LinhaReposicao } from "@/server/services/reposicao";
import { formatarBRL as R } from "@/domain/money";
import { formatarData, hoje, intervaloDoMes } from "@/domain/datas";
import { Mensagens, lerParams, type BuscaParams } from "@/components/Mensagens";

const AGRUPAR: { id: Agrupamento; rotulo: string }[] = [
  { id: "fornecedor", rotulo: "Por fornecedor" },
  { id: "categoria", rotulo: "Por categoria" },
  { id: "produto", rotulo: "Por produto" },
];

function Detalhe({ l }: { l: LinhaReposicao }) {
  const linhas: [string, number][] = [
    ["Repor produtos próprios vendidos", l.reporVendidosCents],
    ["Pagar fornecedores (consignados)", l.repasseFornecedoresCents],
    ["Comissões dos colaboradores", l.comissoesCents],
    ["Repor consumo interno e perdas", l.reporConsumoPerdasCents],
  ];
  return (
    <ul className="lista" style={{ fontSize: "0.92rem" }}>
      {linhas.filter(([, v]) => v !== 0).map(([rot, v]) => <li key={rot}><span>{rot}</span><span className="num">{R(v)}</span></li>)}
    </ul>
  );
}

export default async function Reposicao({ searchParams }: { searchParams: BuscaParams }) {
  const ator = await exigirSessaoPrincipal();
  const { s } = await lerParams(searchParams);
  const mes = s("mes") ?? hoje().slice(0, 7);
  const [iniMes, fimMes] = intervaloDoMes(mes);
  const periodo = { de: s("de") || iniMes, ate: s("ate") || fimMes };
  const agrupar = (AGRUPAR.find((a) => a.id === s("por"))?.id ?? "fornecedor") as Agrupamento;

  let d;
  try {
    d = await demonstrativoReposicao(await getDb(), ator, periodo, agrupar);
  } catch (e) {
    return <Mensagens erro={mensagemDeErro(e) ?? "Período inválido."} />;
  }
  const t = d.total;
  const qs = (por: string) => `/reposicao?por=${por}${s("de") ? `&de=${s("de")}&ate=${s("ate")}` : `&mes=${mes}`}`;

  return (
    <>
      <div className="cabecalho-pagina">
        <div><h1>Reposição e lucro</h1><p className="suave">{formatarData(periodo.de)} a {formatarData(periodo.ate)} · visível só para você</p></div>
      </div>

      <form method="get" className="cartao linha-campos">
        <input type="hidden" name="por" value={agrupar} />
        <div className="campo"><label>Mês</label><input type="month" name="mes" defaultValue={mes} /></div>
        <div className="campo"><label>ou de</label><input type="date" name="de" defaultValue={s("de")} /></div>
        <div className="campo"><label>até</label><input type="date" name="ate" defaultValue={s("ate")} /></div>
        <div className="campo" style={{ alignSelf: "end" }}><button className="btn bloco">Ver período</button></div>
      </form>

      <div className="grade">
        <div className="kpi"><div className="rotulo">Vendas do período (líquido)</div><div className="valor">{R(t.receitaCents)}</div></div>
        <div className="kpi amarelo"><div className="rotulo">Guardar — não gastar</div><div className="valor">{R(t.guardarCents)}</div><div className="detalhe">reposição, fornecedores e comissões</div></div>
        <div className={`kpi ${t.lucroCents >= 0 ? "verde" : "rosa"}`}><div className="rotulo">Seu lucro</div><div className="valor">{R(t.lucroCents)}</div><div className="detalhe">pode usar sem prejudicar o estoque</div></div>
      </div>

      <section className="cartao">
        <h2>Como separar o dinheiro</h2>
        <Detalhe l={t} />
        <div className="acoes" style={{ justifyContent: "space-between", borderTop: "2px solid var(--linha)", paddingTop: 10, marginTop: 4 }}>
          <strong>Total a guardar</strong><strong className="num">{R(t.guardarCents)}</strong>
        </div>
        <p className="suave" style={{ fontSize: "0.82rem", marginTop: 10 }}>
          A reposição dos produtos próprios usa o <strong>custo da última compra</strong> de cada produto, para você conseguir comprar de novo mesmo que o preço tenha subido.
          Despesas gerais do salão (aluguel, contas etc.) não estão incluídas — saem do seu lucro.
        </p>
      </section>

      <div className="acoes" style={{ marginBottom: 12 }}>
        {AGRUPAR.map((a) => <Link key={a.id} href={qs(a.id)} className={`btn pequeno ${a.id === agrupar ? "primario" : ""}`}>{a.rotulo}</Link>)}
      </div>

      {d.linhas.length === 0 && <div className="cartao suave">Nenhuma venda, consumo ou perda no período.</div>}
      {d.linhas.map((l) => (
        <details key={l.chave} className="cartao" style={{ padding: 14 }}>
          <summary style={{ listStyle: "none" }}>
            <div className="acoes" style={{ justifyContent: "space-between" }}><strong>{l.nome}</strong><span className="suave">vendas {R(l.receitaCents)}</span></div>
            <div className="acoes" style={{ justifyContent: "space-between", marginTop: 6 }}>
              <span>Guardar <strong className="num">{R(l.guardarCents)}</strong></span>
              <span className={`selo ${l.lucroCents >= 0 ? "verde" : "rosa"}`}>Lucro {R(l.lucroCents)}</span>
            </div>
          </summary>
          <Detalhe l={l} />
        </details>
      ))}
    </>
  );
}
