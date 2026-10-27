import Link from "next/link";
import { getDb } from "@/server/db";
import { executarAcao, exigirSessaoAdmin } from "@/server/sessao";
import { listarProdutosAdmin } from "@/server/services/cadastros";
import {
  ajustarInventario, anularMovimentacao, corrigirMovimentacao, definirSaldoInicial, listarMovimentacoes, registrarEntrada, registrarSaida,
  type TipoMovimento,
} from "@/server/services/estoque";
import { rotuloMovimento, ROTULO_TIPO } from "@/domain/rotulos";
import { formatarBRL as R } from "@/domain/money";
import { formatarData, hoje } from "@/domain/datas";
import { campo, campoOpcional, dinheiroOpcional, inteiro } from "@/app/formularios";
import { Mensagens, lerParams, type BuscaParams } from "@/components/Mensagens";

const voltar = (fd: FormData) => `/estoque${fd.get("produtoId") ? `?produto=${fd.get("produtoId")}` : ""}`;

async function acaoEntrada(fd: FormData) {
  "use server";
  const ator = await exigirSessaoAdmin();
  const db = await getDb();
  await executarAcao(() => registrarEntrada(db, ator, {
    produtoId: inteiro(fd, "produtoId"), quantidade: inteiro(fd, "quantidade"),
    custoUnitarioCents: dinheiroOpcional(fd, "custo"), dataEfetiva: campoOpcional(fd, "data"), justificativa: campoOpcional(fd, "justificativa"),
  }), voltar(fd), "Entrada registrada.");
}

async function acaoSaida(fd: FormData) {
  "use server";
  const ator = await exigirSessaoAdmin();
  const db = await getDb();
  await executarAcao(() => registrarSaida(db, ator, {
    produtoId: inteiro(fd, "produtoId"), quantidade: inteiro(fd, "quantidade"),
    tipo: campo(fd, "tipo") as "consumo_interno" | "perda" | "dano" | "devolucao_fornecedor",
    dataEfetiva: campoOpcional(fd, "data"), justificativa: campoOpcional(fd, "justificativa"),
    custoUnitarioCents: dinheiroOpcional(fd, "custoHist"), repasseUnitarioCents: dinheiroOpcional(fd, "repasseHist"),
  }), voltar(fd), "Saída registrada.");
}

async function acaoInventario(fd: FormData) {
  "use server";
  const ator = await exigirSessaoAdmin();
  const db = await getDb();
  await executarAcao(() => ajustarInventario(db, ator, {
    produtoId: inteiro(fd, "produtoId"), quantidadeContada: inteiro(fd, "contada"), dataEfetiva: campoOpcional(fd, "data"),
    justificativa: campo(fd, "justificativa"),
    classificacao: (campoOpcional(fd, "classificacao") as "perda" | "dano" | "consumo_interno" | "devolucao_fornecedor" | "erro_registro" | undefined),
  }), voltar(fd), "Inventário ajustado.");
}

async function acaoSaldoInicial(fd: FormData) {
  "use server";
  const ator = await exigirSessaoAdmin();
  const db = await getDb();
  await executarAcao(() => definirSaldoInicial(db, ator, {
    produtoId: inteiro(fd, "produtoId"), quantidade: inteiro(fd, "quantidade"), dataImplantacao: campo(fd, "data"),
    custoUnitarioCents: dinheiroOpcional(fd, "custo"), justificativa: campoOpcional(fd, "justificativa"),
  }), voltar(fd), "Saldo inicial definido.");
}

async function acaoAnular(fd: FormData) {
  "use server";
  const ator = await exigirSessaoAdmin();
  const db = await getDb();
  await executarAcao(() => anularMovimentacao(db, ator, inteiro(fd, "movId"), campo(fd, "justificativa")), voltar(fd), "Movimentação anulada.");
}

async function acaoCorrigir(fd: FormData) {
  "use server";
  const ator = await exigirSessaoAdmin();
  const db = await getDb();
  await executarAcao(() => corrigirMovimentacao(db, ator, inteiro(fd, "movId"), {
    quantidade: inteiro(fd, "quantidade"), dataEfetiva: campo(fd, "data"), justificativa: campo(fd, "justificativa"),
    custoUnitarioCents: dinheiroOpcional(fd, "custo"), repasseUnitarioCents: dinheiroOpcional(fd, "repasse"),
  }), voltar(fd), "Movimentação corrigida (a original foi anulada e vinculada).");
}

export default async function Estoque({ searchParams }: { searchParams: BuscaParams }) {
  const ator = await exigirSessaoAdmin();
  const db = await getDb();
  const { s, ok, erro } = await lerParams(searchParams);
  const produtoId = s("produto") ? Number(s("produto")) : undefined;
  const tipo = (s("tipo") || undefined) as TipoMovimento | undefined;
  const [produtos, movs] = await Promise.all([
    listarProdutosAdmin(db, ator, { incluirInativos: true }),
    listarMovimentacoes(db, ator, { produtoId, tipo, de: s("de"), ate: s("ate"), incluirAnuladas: true, limite: 150 }),
  ]);
  const dia = hoje();
  const seletor = (
    <div className="campo"><label>Produto</label>
      <select name="produtoId" defaultValue={produtoId ?? ""} required>
        <option value="" disabled>Selecione…</option>
        {produtos.map((p) => <option key={p.id} value={p.id}>{p.nome} ({p.modalidade === "consignado" ? "consig." : "próprio"} · {p.quantidade} un)</option>)}
      </select>
    </div>
  );
  const data = <div className="campo"><label>Data efetiva</label><input type="date" name="data" defaultValue={dia} max={dia} /></div>;

  return (
    <>
      <Mensagens ok={ok} erro={erro} />
      <div className="cabecalho-pagina"><div><h1>Estoque</h1><p className="suave">Toda movimentação guarda data efetiva, data de registro e responsável.</p></div></div>

      <details open={!ok && !erro}>
        <summary>Entrada de mercadoria</summary>
        <form action={acaoEntrada}>
          {seletor}
          <div className="linha-campos">
            <div className="campo"><label>Quantidade</label><input name="quantidade" type="number" min={1} inputMode="numeric" required /></div>
            <div className="campo"><label>Custo unitário (R$)</label><input name="custo" inputMode="decimal" /><div className="ajuda">Obrigatório para próprios (custo médio ponderado).</div></div>
            {data}
          </div>
          <div className="campo"><label>Observação</label><input name="justificativa" placeholder="Ex.: nota 123" /></div>
          <button className="btn primario">Registrar entrada</button>
        </form>
      </details>

      <details>
        <summary>Saída: consumo interno, perda, dano ou devolução ao fornecedor</summary>
        <form action={acaoSaida}>
          {seletor}
          <div className="linha-campos">
            <div className="campo"><label>Tipo</label>
              <select name="tipo" required>
                <option value="consumo_interno">Consumo interno</option><option value="perda">Perda</option><option value="dano">Dano</option><option value="devolucao_fornecedor">Devolução ao fornecedor</option>
              </select>
            </div>
            <div className="campo"><label>Quantidade (unidades inteiras)</label><input name="quantidade" type="number" min={1} inputMode="numeric" required /></div>
            {data}
          </div>
          <div className="campo"><label>Justificativa</label><input name="justificativa" /></div>
          <details><summary>Valores da época (lançamento retroativo)</summary>
            <div className="linha-campos">
              <div className="campo"><label>Custo un. (próprio)</label><input name="custoHist" inputMode="decimal" /></div>
              <div className="campo"><label>Repasse un. (consignado)</label><input name="repasseHist" inputMode="decimal" /></div>
            </div>
            <div className="ajuda">Em branco: usa o custo médio / repasse vigente.</div>
          </details>
          <p className="suave" style={{ fontSize: "0.82rem" }}>Consignado: consumo, perda e dano geram repasse ao fornecedor; devolução ao fornecedor não. Nenhuma saída gera comissão.</p>
          <button className="btn primario">Registrar saída</button>
        </form>
      </details>

      <details>
        <summary>Ajuste de inventário (contagem física)</summary>
        <form action={acaoInventario}>
          {seletor}
          <div className="linha-campos">
            <div className="campo"><label>Quantidade contada</label><input name="contada" type="number" min={0} inputMode="numeric" required /></div>
            <div className="campo"><label>Classificação (se faltou mercadoria)</label>
              <select name="classificacao" defaultValue="">
                <option value="">— (só quando sobrou)</option>
                <option value="perda">Perda</option><option value="dano">Dano</option><option value="consumo_interno">Consumo interno</option>
                <option value="devolucao_fornecedor">Devolução ao fornecedor</option><option value="erro_registro">Erro de registro</option>
              </select>
              <div className="ajuda">Define se haverá repasse ao fornecedor.</div>
            </div>
            {data}
          </div>
          <div className="campo"><label>Justificativa (obrigatória)</label><input name="justificativa" required minLength={3} /></div>
          <button className="btn primario">Ajustar inventário</button>
        </form>
      </details>

      <details>
        <summary>Saldo inicial de implantação</summary>
        <form action={acaoSaldoInicial}>
          {seletor}
          <div className="linha-campos">
            <div className="campo"><label>Quantidade na data</label><input name="quantidade" type="number" min={0} inputMode="numeric" required /></div>
            <div className="campo"><label>Custo unitário (próprio)</label><input name="custo" inputMode="decimal" /></div>
            {data}
          </div>
          <p className="suave" style={{ fontSize: "0.82rem" }}>Movimentações com data anterior à implantação continuam valendo para o financeiro, mas não alteram o saldo — evita contar o estoque em dobro.</p>
          <button className="btn primario">Definir saldo inicial</button>
        </form>
      </details>

      <form method="get" className="cartao linha-campos">
        <div className="campo"><label>Produto</label><select name="produto" defaultValue={produtoId ?? ""}><option value="">Todos</option>{produtos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></div>
        <div className="campo"><label>Tipo</label><select name="tipo" defaultValue={tipo ?? ""}><option value="">Todos</option>{Object.entries(ROTULO_TIPO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div className="campo"><label>De</label><input type="date" name="de" defaultValue={s("de")} /></div>
        <div className="campo"><label>Até</label><input type="date" name="ate" defaultValue={s("ate")} /></div>
        <div className="campo" style={{ alignSelf: "end" }}><button className="btn bloco">Filtrar</button></div>
      </form>

      <section className="cartao tabela-wrap">
        <h2>Movimentações</h2>
        <table>
          <thead><tr><th>Data</th><th>Produto</th><th>Tipo</th><th className="num">Qtd.</th><th className="num">Custo/repasse</th><th>Responsável</th><th></th></tr></thead>
          <tbody>
            {movs.map(({ mov: m, produto, usuario }) => {
              const corrigivel = !m.anulada && !["venda", "devolucao_venda"].includes(m.tipo);
              return (
                <tr key={m.id} className={m.anulada ? "anulada" : ""}>
                  <td>{formatarData(m.dataEfetiva)}{!m.afetaEstoque && <><br /><span className="selo">histórico</span></>}</td>
                  <td><Link href={`/produtos/${m.produtoId}`}>{produto}</Link></td>
                  <td>{rotuloMovimento(m.tipo, m.classificacao)}{m.corrigeId && <><br /><small>corrige #{m.corrigeId}</small></>}{m.justificativa && <><br /><small>{m.justificativa}</small></>}</td>
                  <td className="num">{m.quantidade > 0 ? `+${m.quantidade}` : m.quantidade}</td>
                  <td className="num">{m.repasseTotalCents ? `repasse ${R(m.repasseTotalCents)}` : m.custoTotalCents ? `custo ${R(m.custoTotalCents)}` : R(m.custoUnitarioCents * Math.abs(m.quantidade))}</td>
                  <td>{usuario}</td>
                  <td>
                    {m.vendaItemId && <small>venda</small>}
                    {corrigivel && (
                      <details style={{ minWidth: 220 }}>
                        <summary><small>corrigir/anular</small></summary>
                        {(m.tipo === "entrada" || ["consumo_interno", "perda", "dano", "devolucao_fornecedor"].includes(m.tipo)) && (
                          <form action={acaoCorrigir} style={{ marginBottom: 10 }}>
                            <input type="hidden" name="movId" value={m.id} /><input type="hidden" name="produtoId" value={produtoId ?? ""} />
                            <input name="quantidade" type="number" min={1} defaultValue={Math.abs(m.quantidade)} aria-label="Quantidade correta" />
                            <input name="data" type="date" defaultValue={m.dataEfetiva} max={dia} aria-label="Data correta" />
                            {m.modalidade === "proprio" ? <input name="custo" placeholder="Custo un. (R$)" defaultValue={(m.custoUnitarioCents / 100).toFixed(2).replace(".", ",")} /> : <input name="repasse" placeholder="Repasse un. (R$)" defaultValue={(m.repasseUnitarioCents / 100).toFixed(2).replace(".", ",")} />}
                            <input name="justificativa" placeholder="Justificativa" required minLength={3} />
                            <button className="btn pequeno">Corrigir</button>
                          </form>
                        )}
                        <form action={acaoAnular}>
                          <input type="hidden" name="movId" value={m.id} /><input type="hidden" name="produtoId" value={produtoId ?? ""} />
                          <input name="justificativa" placeholder="Motivo da anulação" required minLength={3} />
                          <button className="btn pequeno perigo">Anular</button>
                        </form>
                      </details>
                    )}
                  </td>
                </tr>
              );
            })}
            {movs.length === 0 && <tr><td colSpan={7} className="suave">Nenhuma movimentação.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}
