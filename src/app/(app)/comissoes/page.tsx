import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db";
import { executarAcao, exigirSessao, exigirSessaoAdmin } from "@/server/sessao";
import { registrarPagamentoComissao, resumoComissoes } from "@/server/services/comissoes";
import { ehAdmin } from "@/server/services/permissoes";
import { formatarBRL as R } from "@/domain/money";
import { hoje } from "@/domain/datas";
import { campoOpcional, dinheiro, inteiro } from "@/app/formularios";
import { Mensagens, lerParams, type BuscaParams } from "@/components/Mensagens";

async function acaoPagar(fd: FormData) {
  "use server";
  const ator = await exigirSessaoAdmin();
  const db = await getDb();
  await executarAcao(() => registrarPagamentoComissao(db, ator, {
    colaboradorId: inteiro(fd, "colaboradorId"), valorCents: dinheiro(fd, "valor"), dataEfetiva: campoOpcional(fd, "data"), observacao: campoOpcional(fd, "observacao"),
  }), "/comissoes", "Pagamento registrado.");
}

export default async function Comissoes({ searchParams }: { searchParams: BuscaParams }) {
  const ator = await exigirSessao();
  if (!ehAdmin(ator)) redirect(`/comissoes/${ator.id}`);
  const { ok, erro } = await lerParams(searchParams);
  const linhas = await resumoComissoes(await getDb(), ator);
  const comMovimento = linhas.filter((l) => l.geradoCents || l.saldoPendenteCents || l.pagoCents);
  return (
    <>
      <Mensagens ok={ok} erro={erro} />
      <div className="cabecalho-pagina"><div><h1>Comissões</h1><p className="suave">Saldos acumulados. Pagamentos podem ser parciais.</p></div></div>
      <section className="cartao tabela-wrap">
        <table>
          <thead><tr><th>Colaborador</th><th className="num">Gerada</th><th className="num">Estornos/ajustes</th><th className="num">Paga</th><th className="num">Pendente</th><th>Registrar pagamento</th></tr></thead>
          <tbody>
            {comMovimento.map((l) => (
              <tr key={l.colaboradorId}>
                <td><Link href={`/comissoes/${l.colaboradorId}`}>{l.nome}</Link></td>
                <td className="num">{R(l.geradoCents)}</td>
                <td className="num">{R(l.estornosCents + l.ajustesNegativosCents)}</td>
                <td className="num">{R(l.pagoCents)}</td>
                <td className="num"><strong style={{ color: l.saldoPendenteCents < 0 ? "var(--rosa-escuro)" : undefined }}>{R(l.saldoPendenteCents)}</strong></td>
                <td>
                  {l.saldoPendenteCents > 0 ? (
                    <form action={acaoPagar} className="acoes" style={{ flexWrap: "nowrap" }}>
                      <input type="hidden" name="colaboradorId" value={l.colaboradorId} />
                      <input name="valor" inputMode="decimal" defaultValue={(l.saldoPendenteCents / 100).toFixed(2).replace(".", ",")} style={{ width: 110 }} aria-label="Valor" />
                      <input name="data" type="date" defaultValue={hoje()} max={hoje()} style={{ width: 150 }} aria-label="Data" />
                      <input name="observacao" placeholder="Obs." style={{ width: 110 }} />
                      <button className="btn pequeno primario">Pagar</button>
                    </form>
                  ) : <small className="suave">{l.saldoPendenteCents < 0 ? "a compensar" : "em dia"}</small>}
                </td>
              </tr>
            ))}
            {comMovimento.length === 0 && <tr><td colSpan={6} className="suave">Nenhuma comissão registrada.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}
