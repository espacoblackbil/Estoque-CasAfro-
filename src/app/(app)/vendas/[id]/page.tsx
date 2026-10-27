import Link from "next/link";
import { getDb } from "@/server/db";
import { executarAcao, exigirSessao, exigirSessaoAdmin } from "@/server/sessao";
import { devolverVenda, obterVenda } from "@/server/services/vendas";
import { ehAdmin } from "@/server/services/permissoes";
import { formatarBRL as R } from "@/domain/money";
import { formatarData, formatarDataHora, hoje } from "@/domain/datas";
import { campo, campoOpcional } from "@/app/formularios";
import { Mensagens, lerParams, type BuscaParams } from "@/components/Mensagens";

const FORMA: Record<string, string> = { pix: "Pix", dinheiro: "Dinheiro", debito: "Débito", credito: "Crédito" };

async function acaoDevolver(fd: FormData) {
  "use server";
  const ator = await exigirSessaoAdmin();
  const id = Number(fd.get("vendaId"));
  const tudo = fd.get("modo") === "tudo";
  const itens = tudo ? undefined : [...fd.entries()]
    .filter(([k, v]) => k.startsWith("dev_") && String(v).trim() !== "" && Number(v) > 0)
    .map(([k, v]) => ({ vendaItemId: Number(k.slice(4)), quantidade: Number(v) }));
  await executarAcao(
    async () => {
      if (!tudo && !itens?.length) throw new Error("Valor inválido: informe a quantidade a devolver");
      await devolverVenda(await getDb(), ator, id, { itens, justificativa: campo(fd, "justificativa"), dataEfetiva: campoOpcional(fd, "data") });
    },
    `/vendas/${id}`,
    tudo ? "Venda cancelada. Estoque, repasse e comissão foram estornados." : "Devolução registrada.",
  );
}

export default async function Venda({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: BuscaParams }) {
  const ator = await exigirSessao();
  const { id } = await params;
  const { ok, erro } = await lerParams(searchParams);
  const v = await obterVenda(await getDb(), ator, Number(id));
  const admin = ehAdmin(ator);
  const restante = v.itens.reduce((a, i) => a + i.quantidade - i.qtdDevolvida, 0);
  return (
    <>
      <Mensagens ok={ok} erro={erro} />
      <div className="cabecalho-pagina">
        <div>
          <h1>Venda #{v.id}</h1>
          <p className="suave">{formatarData(v.dataEfetiva)} · registrada em {formatarDataHora(v.criadoEm)} por {v.registradoPor}</p>
        </div>
        <Link className="btn" href="/vendas">Voltar</Link>
      </div>
      <div className="grade">
        <div className="kpi verde"><div className="rotulo">Total</div><div className="valor">{R(v.liquidoCents)}</div></div>
        <div className="kpi"><div className="rotulo">Colaborador</div><div className="valor" style={{ fontSize: "1.05rem" }}>{v.colaborador}</div><div className="detalhe">{v.cliente ? `Cliente: ${v.cliente}` : "Cliente não informado"}</div></div>
        <div className="kpi"><div className="rotulo">Situação</div><div className="valor" style={{ fontSize: "1.05rem" }}>{v.situacao === "ativa" ? "Ativa" : v.situacao === "cancelada" ? "Cancelada" : "Devolução parcial"}</div>
          <div className="detalhe">{v.estoqueNegativo && "Vendida com estoque negativo. "}{v.autorizadoPor && `Margem negativa autorizada por ${v.autorizadoPor}.`}</div></div>
      </div>
      <section className="cartao tabela-wrap">
        <h2>Itens</h2>
        <table>
          <thead><tr><th>Produto</th><th className="num">Qtd.</th><th className="num">Preço</th><th className="num">Desconto</th><th className="num">Líquido</th><th className="num">Comissão</th>
            {admin && <><th className="num">Custo/repasse</th><th className="num">Margem</th></>}</tr></thead>
          <tbody>
            {v.itens.map((i) => {
              const extra = i as typeof i & { custoTotalCents?: number; repasseTotalCents?: number; margemCents?: number; modalidade?: string };
              return (
                <tr key={i.id}>
                  <td>{i.produto}{i.qtdDevolvida > 0 && <><br /><span className="selo rosa">{i.qtdDevolvida} devolvida(s)</span></>}{admin && extra.modalidade === "consignado" && <> <span className="selo amarelo">consignado</span></>}</td>
                  <td className="num">{i.quantidade}</td>
                  <td className="num">{R(i.precoUnitarioCents)}</td>
                  <td className="num">{i.descontoCents ? R(i.descontoCents) : "—"}</td>
                  <td className="num">{R(i.liquidoCents)}</td>
                  <td className="num">{R(i.comissaoCents)}</td>
                  {admin && <><td className="num">{R((extra.custoTotalCents ?? 0) + (extra.repasseTotalCents ?? 0))}</td><td className="num" style={{ color: (extra.margemCents ?? 0) < 0 ? "var(--rosa-escuro)" : undefined }}>{R(extra.margemCents ?? 0)}</td></>}
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr><td>Total</td><td /><td className="num">{R(v.brutoCents)}</td><td className="num">{R(v.descontoItensCents + v.descontoTotalCents)}</td><td className="num">{R(v.liquidoCents)}</td><td className="num">{R(v.itens.reduce((a, i) => a + i.comissaoCents, 0))}</td>{admin && <><td /><td /></>}</tr></tfoot>
        </table>
        <p style={{ marginTop: 12 }}><strong>Pagamento:</strong> {v.pagamentos.map((p) => `${FORMA[p.forma]} ${R(p.valorCents)}`).join(" · ") || "—"}</p>
      </section>

      {v.devolucoes.length > 0 && (
        <section className="cartao">
          <h2>Devoluções e cancelamentos</h2>
          <ul className="lista">{v.devolucoes.map((d, k) => <li key={k}><span>{formatarData(d.dataEfetiva)} · {d.quantidade} un · {d.justificativa}</span><strong className="num">−{R(d.liquidoCents)}</strong></li>)}</ul>
        </section>
      )}

      {admin && restante > 0 && (
        <section className="cartao">
          <h2>Cancelar ou devolver</h2>
          <p className="suave">O estoque volta, o repasse do consignado é estornado e a comissão é estornada (ou vira ajuste negativo, se já foi paga). Nada é apagado.</p>
          <details>
            <summary>Devolver itens específicos</summary>
            <form action={acaoDevolver}>
              <input type="hidden" name="vendaId" value={v.id} />
              {v.itens.filter((i) => i.quantidade > i.qtdDevolvida).map((i) => (
                <div className="campo" key={i.id}><label>{i.produto} (até {i.quantidade - i.qtdDevolvida})</label><input name={`dev_${i.id}`} inputMode="numeric" type="number" min={0} max={i.quantidade - i.qtdDevolvida} /></div>
              ))}
              <div className="linha-campos">
                <div className="campo"><label>Data</label><input type="date" name="data" defaultValue={hoje()} max={hoje()} min={v.dataEfetiva} /></div>
                <div className="campo"><label>Justificativa</label><input name="justificativa" required minLength={3} /></div>
              </div>
              <button className="btn">Registrar devolução</button>
            </form>
          </details>
          <details>
            <summary>Cancelar a venda inteira</summary>
            <form action={acaoDevolver}>
              <input type="hidden" name="vendaId" value={v.id} />
              <input type="hidden" name="modo" value="tudo" />
              <div className="linha-campos">
                <div className="campo"><label>Data do cancelamento</label><input type="date" name="data" defaultValue={hoje()} max={hoje()} min={v.dataEfetiva} /></div>
                <div className="campo"><label>Justificativa</label><input name="justificativa" required minLength={3} /></div>
              </div>
              <button className="btn perigo">Cancelar venda</button>
            </form>
          </details>
        </section>
      )}
    </>
  );
}
