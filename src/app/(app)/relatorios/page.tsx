import { getDb } from "@/server/db";
import { executarAcao, exigirSessaoAdmin } from "@/server/sessao";
import { emitirInventario, emitirRelatorio, fechamento, listarEmissoes, type TipoRelatorio } from "@/server/services/relatorios";
import { listarFornecedores, listarProdutosAdmin } from "@/server/services/cadastros";
import { listarVendedores } from "@/server/services/usuarios";
import { formatarData, formatarDataHora, hoje, intervaloDoMes } from "@/domain/datas";
import { campo, inteiroOpcional } from "@/app/formularios";
import { ErroNegocio } from "@/server/erros";
import { Mensagens, lerParams, type BuscaParams } from "@/components/Mensagens";

function periodoDoForm(fd: FormData) {
  if (campo(fd, "modo") === "mes") {
    const [de, ate] = intervaloDoMes(campo(fd, "mes"));
    return { de, ate };
  }
  return { de: campo(fd, "de"), ate: campo(fd, "ate") };
}

async function acaoFechamento(fd: FormData) {
  "use server";
  const ator = await exigirSessaoAdmin();
  const db = await getDb();
  await executarAcao(() => fechamento(db, ator, periodoDoForm(fd)), "/relatorios", (r) => {
    const novas = r.filter((x) => x.nova);
    const retif = novas.filter((x) => x.emissao.retificado).length;
    return `Fechamento: ${r.length} relatório(s); ${novas.length} nova(s) versão(ões)${retif ? `, ${retif} retificada(s)` : ""}; ${r.length - novas.length} sem alteração.`;
  });
}

async function acaoInventario(fd: FormData) {
  "use server";
  const ator = await exigirSessaoAdmin();
  const db = await getDb();
  const escopo = campo(fd, "escopo");
  await executarAcao(async () => {
    const fornecedorId = escopo === "fornecedor" ? inteiroOpcional(fd, "fornecedorId") : undefined;
    const produtoId = escopo === "produto" ? inteiroOpcional(fd, "produtoId") : undefined;
    if (escopo === "fornecedor" && !fornecedorId) throw new ErroNegocio("Selecione o fornecedor do inventário.");
    if (escopo === "produto" && !produtoId) throw new ErroNegocio("Selecione o produto do inventário.");
    return emitirInventario(db, ator, { fornecedorId, produtoId });
  }, "/relatorios", (r) => r.nova ? "Relatório de inventário emitido. Toque em PDF na lista abaixo." : "O estoque não mudou desde a última emissão de hoje; a versão existente foi mantida.");
}

async function acaoEmitir(fd: FormData) {
  "use server";
  const ator = await exigirSessaoAdmin();
  const db = await getDb();
  await executarAcao(() => emitirRelatorio(db, ator, {
    tipo: campo(fd, "tipo") as TipoRelatorio,
    escopoId: inteiroOpcional(fd, campo(fd, "tipo") === "fornecedor" ? "fornecedorId" : "colaboradorId"),
    periodo: periodoDoForm(fd),
  }), "/relatorios", "Relatório emitido. Se nada mudou desde a última emissão, a versão existente foi mantida.");
}

function SeletorPeriodo() {
  const mes = hoje().slice(0, 7);
  const [de, ate] = intervaloDoMes(mes);
  return (
    <div className="linha-campos">
      <div className="campo"><label>Período</label>
        <select name="modo" defaultValue="mes"><option value="mes">Mês completo</option><option value="intervalo">Intervalo personalizado</option></select>
      </div>
      <div className="campo"><label>Mês</label><input type="month" name="mes" defaultValue={mes} /></div>
      <div className="campo"><label>De (intervalo)</label><input type="date" name="de" defaultValue={de} /></div>
      <div className="campo"><label>Até (intervalo)</label><input type="date" name="ate" defaultValue={ate} /></div>
    </div>
  );
}

export default async function Relatorios({ searchParams }: { searchParams: BuscaParams }) {
  const ator = await exigirSessaoAdmin();
  const db = await getDb();
  const { ok, erro } = await lerParams(searchParams);
  const [emissoes, fornecedores, pessoas, produtos] = await Promise.all([listarEmissoes(db, ator, { limite: 100 }), listarFornecedores(db, ator), listarVendedores(db, ator), listarProdutosAdmin(db, ator, { incluirInativos: true })]);
  return (
    <>
      <Mensagens ok={ok} erro={erro} />
      <div className="cabecalho-pagina"><div><h1>Central de Relatórios</h1><p className="suave">Fechamento mensal em PDF. Correções posteriores geram versões retificadas; as anteriores ficam arquivadas.</p></div></div>
      <section className="cartao">
        <h2>Fechamento do período</h2>
        <p className="suave">Gera o PDF geral, o resumo de comissões e os PDFs individuais de cada fornecedor com repasse e de cada colaborador com movimento.</p>
        <form action={acaoFechamento}>
          <SeletorPeriodo />
          <button className="btn primario">Gerar fechamento</button>
        </form>
      </section>
      <section className="cartao">
        <h2>Relatório de inventário</h2>
        <p className="suave">Tudo o que está disponível no estoque agora, com quantidades e valores. Gere o geral, de um fornecedor ou de um produto.</p>
        <form action={acaoInventario}>
          <div className="linha-campos">
            <div className="campo"><label>Mostrar</label>
              <select name="escopo" defaultValue="geral">
                <option value="geral">Geral — todos os produtos</option>
                <option value="fornecedor">Só um fornecedor</option>
                <option value="produto">Só um produto</option>
              </select>
            </div>
            <div className="campo"><label>Fornecedor (se escolheu fornecedor)</label><select name="fornecedorId"><option value="">—</option>{fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}</select></div>
            <div className="campo"><label>Produto (se escolheu produto)</label><select name="produtoId"><option value="">—</option>{produtos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></div>
          </div>
          <button className="btn primario">Gerar inventário em PDF</button>
        </form>
      </section>
      <details>
        <summary>Emitir um relatório específico</summary>
        <form action={acaoEmitir}>
          <div className="linha-campos">
            <div className="campo"><label>Relatório</label>
              <select name="tipo"><option value="geral">Geral da CasAfro</option><option value="fornecedor">Fornecedor (prestação de contas)</option><option value="colaborador">Colaborador</option><option value="comissoes">Resumo de comissões</option></select>
            </div>
            <div className="campo"><label>Fornecedor</label><select name="fornecedorId"><option value="">—</option>{fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}</select></div>
            <div className="campo"><label>Colaborador</label><select name="colaboradorId"><option value="">—</option>{pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></div>
          </div>
          <SeletorPeriodo />
          <button className="btn">Emitir PDF</button>
        </form>
      </details>
      <section className="cartao tabela-wrap">
        <h2>Relatórios emitidos</h2>
        <table>
          <thead><tr><th>Relatório</th><th>Período</th><th>Versão</th><th>Emissão</th><th></th></tr></thead>
          <tbody>
            {emissoes.map((e) => (
              <tr key={e.id}>
                <td>{e.titulo}{e.escopo && <><br /><small>{e.escopo}</small></>}</td>
                <td>{e.tipo === "inventario" ? `Posição de ${formatarDataHora(e.emitidoEm)}` : `${formatarData(e.inicio)} a ${formatarData(e.fim)}`}</td>
                <td>v{e.versao} {e.retificado && <span className="selo rosa">retificado</span>}</td>
                <td>{formatarDataHora(e.emitidoEm)}<br /><small>{e.emitidoPor}</small></td>
                <td><a className="btn pequeno" href={`/relatorios/${e.id}/pdf`} target="_blank" rel="noopener">PDF</a></td>
              </tr>
            ))}
            {emissoes.length === 0 && <tr><td colSpan={5} className="suave">Nenhum relatório emitido ainda.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}
