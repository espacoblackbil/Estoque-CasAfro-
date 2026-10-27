import Link from "next/link";
import { getDb } from "@/server/db";
import { executarAcao, exigirSessaoAdmin } from "@/server/sessao";
import { editarProduto, listarCategorias, listarFornecedores, obterProdutoAdmin } from "@/server/services/cadastros";
import { listarMovimentacoes } from "@/server/services/estoque";
import { listarAuditoria } from "@/server/services/auditoria";
import { rotuloMovimento } from "@/domain/rotulos";
import { formatarBRL as R } from "@/domain/money";
import { formatarData, formatarDataHora } from "@/domain/datas";
import { ProdutoForm } from "@/components/ProdutoForm";
import { Mensagens, lerParams, type BuscaParams } from "@/components/Mensagens";
import { justificativaDoForm, produtoDoForm } from "../dados";

async function acaoEditar(fd: FormData) {
  "use server";
  const ator = await exigirSessaoAdmin();
  const db = await getDb();
  const id = Number(fd.get("id"));
  await executarAcao(() => editarProduto(db, ator, id, produtoDoForm(fd), justificativaDoForm(fd)), `/produtos/${id}`, "Produto atualizado.");
}

export default async function Produto({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: BuscaParams }) {
  const ator = await exigirSessaoAdmin();
  const db = await getDb();
  const id = Number((await params).id);
  const { ok, erro } = await lerParams(searchParams);
  const [p, categorias, fornecedores, movs, auditoria] = await Promise.all([
    obterProdutoAdmin(db, ator, id),
    listarCategorias(db),
    listarFornecedores(db, ator),
    listarMovimentacoes(db, ator, { produtoId: id, incluirAnuladas: true, limite: 100 }),
    listarAuditoria(db, ator, { entidade: "produto", limite: 500 }),
  ]);
  const alteracoes = auditoria.filter((a) => a.entidadeId === String(id));
  return (
    <>
      <Mensagens ok={ok} erro={erro} />
      <div className="cabecalho-pagina">
        <div><h1>{p.nome}</h1><p className="suave">{p.modalidade === "consignado" ? "Consignado" : "Próprio"} · estoque {p.quantidade}{p.dataImplantacao && ` · implantado em ${formatarData(p.dataImplantacao)}`}</p></div>
        <Link className="btn" href={`/estoque?produto=${p.id}`}>Movimentar estoque</Link>
      </div>
      {p.pendenteQtd > 0 && <div className="aviso atencao">{p.pendenteQtd} unidade(s) vendidas sem saldo com custo estimado de {R(p.pendenteCustoCents)}. O ajuste será lançado na próxima entrada.</div>}
      <ProdutoForm acao={acaoEditar} categorias={categorias} fornecedores={fornecedores} produto={p} temMovimentacoes={movs.length > 0} />
      <section className="cartao tabela-wrap">
        <h2>Histórico de entradas e saídas</h2>
        <table>
          <thead><tr><th>Data</th><th>Tipo</th><th className="num">Qtd.</th><th className="num">Custo/repasse un.</th><th>Usuário</th><th>Justificativa</th></tr></thead>
          <tbody>
            {movs.map(({ mov: m, usuario }) => (
              <tr key={m.id} className={m.anulada ? "anulada" : ""}>
                <td>{formatarData(m.dataEfetiva)}{!m.afetaEstoque && <><br /><span className="selo">histórico</span></>}</td>
                <td>{rotuloMovimento(m.tipo, m.classificacao)}{m.ajusteCustoCents ? <><br /><small>ajuste de custo {R(m.ajusteCustoCents)}</small></> : null}</td>
                <td className="num">{m.quantidade > 0 ? `+${m.quantidade}` : m.quantidade}</td>
                <td className="num">{R(m.modalidade === "proprio" ? m.custoUnitarioCents : m.repasseUnitarioCents)}</td>
                <td>{usuario}<br /><small>{formatarDataHora(m.registradoEm)}</small></td>
                <td>{m.justificativa ?? ""}</td>
              </tr>
            ))}
            {movs.length === 0 && <tr><td colSpan={6} className="suave">Sem movimentações.</td></tr>}
          </tbody>
        </table>
      </section>
      <section className="cartao">
        <h2>Alterações de cadastro</h2>
        <ul className="lista">
          {alteracoes.map((a) => (
            <li key={a.id}><span>{a.acao.replace(/_/g, " ")} — {a.usuario}{a.justificativa && <><br /><small>{a.justificativa}</small></>}</span><small>{formatarDataHora(a.criadoEm)}</small></li>
          ))}
        </ul>
      </section>
    </>
  );
}
