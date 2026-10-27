import { getDb } from "@/server/db";
import { exigirSessaoAdmin } from "@/server/sessao";
import { listarAuditoria } from "@/server/services/auditoria";
import { formatarData, formatarDataHora } from "@/domain/datas";
import { lerParams, type BuscaParams } from "@/components/Mensagens";

const ENTIDADES = ["produto", "movimentacao", "venda", "usuario", "fornecedor", "categoria", "comissao_pagamento", "configuracoes"];

function resumo(v: unknown) {
  if (v == null) return "";
  const t = JSON.stringify(v, null, 1);
  return t.length > 600 ? t.slice(0, 600) + "…" : t;
}

export default async function Auditoria({ searchParams }: { searchParams: BuscaParams }) {
  const ator = await exigirSessaoAdmin();
  const { s } = await lerParams(searchParams);
  const linhas = await listarAuditoria(await getDb(), ator, { entidade: s("entidade") || undefined, de: s("de") || undefined, ate: s("ate") || undefined, limite: 300 });
  return (
    <>
      <div className="cabecalho-pagina"><div><h1>Auditoria</h1><p className="suave">Registro permanente: o banco de dados impede alteração ou exclusão destas linhas.</p></div></div>
      <form method="get" className="cartao linha-campos">
        <div className="campo"><label>Entidade</label><select name="entidade" defaultValue={s("entidade") ?? ""}><option value="">Todas</option>{ENTIDADES.map((e) => <option key={e} value={e}>{e.replace(/_/g, " ")}</option>)}</select></div>
        <div className="campo"><label>De</label><input type="date" name="de" defaultValue={s("de")} /></div>
        <div className="campo"><label>Até</label><input type="date" name="ate" defaultValue={s("ate")} /></div>
        <div className="campo" style={{ alignSelf: "end" }}><button className="btn bloco">Filtrar</button></div>
      </form>
      <section className="cartao">
        <ul className="lista">
          {linhas.map((l) => (
            <li key={l.id} style={{ display: "block" }}>
              <div className="acoes" style={{ justifyContent: "space-between" }}>
                <span><strong>{l.acao.replace(/_/g, " ")}</strong> · {l.entidade} {l.entidadeId && `#${l.entidadeId}`} · {l.usuario ?? "sistema"}</span>
                <small>{formatarDataHora(l.criadoEm)}{l.dataEfetiva && ` · data efetiva ${formatarData(l.dataEfetiva)}`}</small>
              </div>
              {l.justificativa && <div><small>Justificativa: {l.justificativa}</small></div>}
              {(l.antes != null || l.depois != null) && (
                <details style={{ marginTop: 6 }}><summary><small>antes / depois</small></summary>
                  <div className="grade-2"><pre style={{ whiteSpace: "pre-wrap", fontSize: "0.75rem", margin: 0 }}>{resumo(l.antes)}</pre><pre style={{ whiteSpace: "pre-wrap", fontSize: "0.75rem", margin: 0 }}>{resumo(l.depois)}</pre></div>
                </details>
              )}
            </li>
          ))}
          {linhas.length === 0 && <li className="suave">Nenhum registro.</li>}
        </ul>
      </section>
    </>
  );
}
