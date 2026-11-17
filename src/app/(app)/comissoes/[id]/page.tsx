import Link from "next/link";
import { getDb } from "@/server/db";
import { exigirSessao } from "@/server/sessao";
import { extratoComissoes } from "@/server/services/comissoes";
import { listarUsuarios } from "@/server/services/usuarios";
import { ehAdmin } from "@/server/services/permissoes";
import { formatarBRL as R } from "@/domain/money";
import { formatarData } from "@/domain/datas";

const TIPO: Record<string, string> = { gerada: "Gerada", estorno: "Estorno", ajuste_negativo: "Ajuste negativo" };

export default async function Extrato({ params }: { params: Promise<{ id: string }> }) {
  const ator = await exigirSessao();
  const db = await getDb();
  const id = Number((await params).id);
  const e = await extratoComissoes(db, ator, id); // valida: colaborador só vê o próprio
  const nome = (await listarUsuarios(db, ator)).find((u) => u.id === id)?.nome ?? "";
  return (
    <>
      <div className="cabecalho-pagina">
        <div><h1>Comissões{ehAdmin(ator) ? ` — ${nome}` : ""}</h1><p className="suave">Extrato completo, sem exclusões.</p></div>
        {ehAdmin(ator) && <Link className="btn" href="/comissoes">Voltar</Link>}
      </div>
      <div className="grade">
        <div className="kpi"><div className="rotulo">Geradas</div><div className="valor">{R(e.geradoCents)}</div></div>
        <div className="kpi"><div className="rotulo">Pagas</div><div className="valor">{R(e.pagoCents)}</div></div>
        <div className="kpi rosa"><div className="rotulo">Estornos e ajustes</div><div className="valor">{R(e.estornosCents + e.ajustesNegativosCents)}</div></div>
        <div className="kpi amarelo"><div className="rotulo">Saldo pendente</div><div className="valor">{R(e.saldoPendenteCents)}</div>{e.saldoPendenteCents < 0 && <div className="detalhe">Será compensado nas próximas comissões.</div>}</div>
      </div>
      <div className="grade-2">
        <section className="cartao">
          <h2>Lançamentos</h2>
          <ul className="lista">
            {e.lancamentos.map((l) => (
              <li key={l.id}><span><span className={`selo ${l.tipo === "gerada" ? "verde" : "rosa"}`}>{TIPO[l.tipo]}</span> {formatarData(l.dataEfetiva)}<br /><small>{l.descricao}</small></span><strong className="num">{R(l.valorCents)}</strong></li>
            ))}
            {e.lancamentos.length === 0 && <li className="suave">Nenhum lançamento.</li>}
          </ul>
        </section>
        <section className="cartao">
          <h2>Pagamentos recebidos</h2>
          <ul className="lista">
            {e.pagamentos.map((p) => <li key={p.id}><span>{formatarData(p.dataEfetiva)}<br /><small>{p.observacao}</small></span><strong className="num">{R(p.valorCents)}</strong></li>)}
            {e.pagamentos.length === 0 && <li className="suave">Nenhum pagamento.</li>}
          </ul>
        </section>
      </div>
    </>
  );
}
