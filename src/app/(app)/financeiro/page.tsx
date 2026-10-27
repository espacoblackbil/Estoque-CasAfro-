import Link from "next/link";
import { getDb } from "@/server/db";
import { exigirSessaoAdmin } from "@/server/sessao";
import {
  apurarResultado, movimentacaoPorTipo, pagamentosPorForma, repassesPorFornecedor, totaisComissoesPeriodo, valoresEstoque,
} from "@/server/services/financeiro";
import { formatarBRL as R } from "@/domain/money";
import { formatarData, hoje, intervaloDoMes } from "@/domain/datas";
import { rotuloMovimento } from "@/domain/rotulos";
import { Mensagens, lerParams, type BuscaParams } from "@/components/Mensagens";
import { mensagemDeErro } from "@/server/sessao";

const FORMA: Record<string, string> = { pix: "Pix", dinheiro: "Dinheiro", debito: "Débito", credito: "Crédito" };

export default async function Financeiro({ searchParams }: { searchParams: BuscaParams }) {
  const ator = await exigirSessaoAdmin();
  const db = await getDb();
  const { s } = await lerParams(searchParams);
  const [iniMes, fimMes] = intervaloDoMes((s("mes") ?? hoje().slice(0, 7)));
  const periodo = { de: s("de") || iniMes, ate: s("ate") || fimMes };

  let dados;
  try {
    dados = await Promise.all([
      apurarResultado(db, ator, periodo),
      pagamentosPorForma(db, ator, periodo),
      repassesPorFornecedor(db, ator, periodo),
      movimentacaoPorTipo(db, ator, periodo),
      totaisComissoesPeriodo(db, ator, periodo),
      valoresEstoque(db, ator),
    ]);
  } catch (e) {
    return <Mensagens erro={mensagemDeErro(e) ?? "Período inválido."} />;
  }
  const [r, pags, forn, movs, com, est] = dados;
  const linhas: [string, number, boolean?][] = [
    ["Faturamento bruto", r.faturamentoBrutoCents],
    ["(−) Descontos concedidos", -r.descontosCents],
    ["(−) Devoluções e cancelamentos", -r.devolucoesCents],
    ["= Receita líquida de vendas", r.receitaLiquidaCents, true],
    ["(−) Custo das mercadorias próprias vendidas", -r.cmvProprioCents],
    ["(−) Repasses de consignados vendidos", -r.repassesVendidosCents],
    ["(−) Comissões geradas", -r.comissoesCents],
    ["(−) Consumo interno", -r.consumoInternoCents],
    ["(−) Perdas e danos", -r.perdasDanosCents],
  ];

  return (
    <>
      <div className="cabecalho-pagina">
        <div><h1>Financeiro</h1><p className="suave">{formatarData(periodo.de)} a {formatarData(periodo.ate)} · operação com produtos</p></div>
        <Link className="btn" href="/relatorios">Gerar PDF</Link>
      </div>
      <form method="get" className="cartao linha-campos">
        <div className="campo"><label>Mês</label><input type="month" name="mes" defaultValue={periodo.de.slice(0, 7)} /></div>
        <div className="campo"><label>ou de</label><input type="date" name="de" defaultValue={s("de")} /></div>
        <div className="campo"><label>até</label><input type="date" name="ate" defaultValue={s("ate")} /></div>
        <div className="campo" style={{ alignSelf: "end" }}><button className="btn bloco">Ver período</button></div>
      </form>

      <div className="grade">
        <div className="kpi verde"><div className="rotulo">Receita líquida</div><div className="valor">{R(r.receitaLiquidaCents)}</div><div className="detalhe">{r.quantidadeVendas} venda(s) · {r.unidadesVendidas} un</div></div>
        <div className={`kpi ${r.resultadoEstimadoCents >= 0 ? "amarelo" : "rosa"}`}><div className="rotulo">Resultado estimado</div><div className="valor">{R(r.resultadoEstimadoCents)}</div></div>
        <div className="kpi"><div className="rotulo">Devido a fornecedores</div><div className="valor">{R(r.repasseDevidoTotalCents)}</div></div>
      </div>

      <div className="grade-2">
        <section className="cartao tabela-wrap">
          <h2>Demonstrativo do resultado</h2>
          <table>
            <tbody>{linhas.map(([rot, v, forte]) => <tr key={rot}><td>{forte ? <strong>{rot}</strong> : rot}</td><td className="num">{forte ? <strong>{R(v)}</strong> : R(v)}</td></tr>)}</tbody>
            <tfoot><tr><td>= Resultado estimado</td><td className="num">{R(r.resultadoEstimadoCents)}</td></tr></tfoot>
          </table>
          {r.ajusteCustoEstoqueNegativoCents !== 0 && <p className="suave" style={{ fontSize: "0.82rem", marginTop: 8 }}>O custo inclui {R(r.ajusteCustoEstoqueNegativoCents)} de ajuste por regularização de estoque negativo.</p>}
          <p className="suave" style={{ fontSize: "0.82rem", marginTop: 8 }}>Não é o lucro líquido do salão: despesas gerais não estão incluídas.</p>
        </section>

        <section className="cartao tabela-wrap">
          <h2>Repasses a fornecedores</h2>
          <table>
            <thead><tr><th>Fornecedor</th><th className="num">Vendas</th><th className="num">Consumo</th><th className="num">Perdas</th><th className="num">Total</th></tr></thead>
            <tbody>
              {forn.map((f) => <tr key={f.fornecedorId}><td>{f.nome}</td><td className="num">{R(f.vendasCents)}</td><td className="num">{R(f.consumoCents)}</td><td className="num">{R(f.perdasCents)}</td><td className="num"><strong>{R(f.totalCents)}</strong></td></tr>)}
              {forn.length === 0 && <tr><td colSpan={5} className="suave">Nenhum repasse no período.</td></tr>}
            </tbody>
          </table>
          <p className="suave" style={{ fontSize: "0.82rem", marginTop: 8 }}>Valor apurado; o controle do pagamento ao fornecedor fica fora do sistema.</p>
        </section>

        <section className="cartao tabela-wrap">
          <h2>Recebimentos por forma</h2>
          <table>
            <tbody>{pags.map((p) => <tr key={p.forma}><td>{FORMA[p.forma]}</td><td className="num">{R(p.valorCents)}</td></tr>)}
              {pags.length === 0 && <tr><td className="suave">Sem vendas.</td></tr>}</tbody>
            <tfoot><tr><td>Total</td><td className="num">{R(pags.reduce((a, p) => a + p.valorCents, 0))}</td></tr></tfoot>
          </table>
        </section>

        <section className="cartao">
          <h2>Comissões</h2>
          <ul className="lista">
            <li><span>Geradas no período</span><strong className="num">{R(com.geradasCents)}</strong></li>
            <li><span>Estornos e ajustes</span><strong className="num">{R(com.estornosAjustesCents)}</strong></li>
            <li><span>Pagas no período</span><strong className="num">{R(com.pagasCents)}</strong></li>
            <li><span>Pendente ao fim do período</span><strong className="num">{R(com.pendenteFimPeriodoCents)}</strong></li>
          </ul>
        </section>

        <section className="cartao tabela-wrap">
          <h2>Entradas e saídas do estoque</h2>
          <table>
            <thead><tr><th>Movimentação</th><th className="num">Unid.</th><th className="num">A custo</th><th className="num">Repasse</th></tr></thead>
            <tbody>{movs.map((m) => <tr key={`${m.tipo}-${m.classificacao}`}><td>{rotuloMovimento(m.tipo, m.classificacao)}</td><td className="num">{m.unidades}</td><td className="num">{R(m.valorCustoCents)}</td><td className="num">{R(m.repasseCents)}</td></tr>)}
              {movs.length === 0 && <tr><td colSpan={4} className="suave">Sem movimentações.</td></tr>}</tbody>
          </table>
        </section>

        <section className="cartao">
          <h2>Valores do estoque (agora)</h2>
          <ul className="lista">
            <li><span>Próprio, a custo médio</span><strong className="num">{R(est.custoEstoqueProprioCents)}</strong></li>
            <li><span>Consignado em poder (a repasse)</span><strong className="num">{R(est.valorConsignadoEmPoderCents)}</strong></li>
            <li><span>Tudo a preço de venda</span><strong className="num">{R(est.valorEstoqueAPrecoDeVendaCents)}</strong></li>
          </ul>
          {est.unidadesNegativas > 0 && <div className="aviso atencao" style={{ marginTop: 8 }}>{est.unidadesNegativas} produto(s) com saldo negativo.</div>}
        </section>
      </div>
    </>
  );
}
