"use client";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import type { ProdutoPublico } from "@/server/services/cadastros";
import { formatarBRL as R, parseBRL, parsePercentual } from "@/domain/money";
import { acaoRegistrarVenda, type RespostaVenda } from "./acoes";

type Forma = "pix" | "dinheiro" | "debito" | "credito";
const FORMAS: { id: Forma; rotulo: string }[] = [
  { id: "pix", rotulo: "Pix" },
  { id: "dinheiro", rotulo: "Dinheiro" },
  { id: "debito", rotulo: "Débito" },
  { id: "credito", rotulo: "Crédito" },
];

interface Linha {
  produto: ProdutoPublico; qtd: number; desconto: string;
  /** Valores da época (venda retroativa, só admin). Vazio = valor vigente. */
  preco: string; custo: string; comissao: string;
}

const centavos = (t: string) => {
  try { return t.trim() ? parseBRL(t) : 0; } catch { return NaN; }
};
const novaChave = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export function Pdv(props: { produtos: ProdutoPublico[]; modalidades?: Record<number, "proprio" | "consignado">; vendedores: { id: number; nome: string }[]; admin: boolean; atorId: number; hoje: string }) {
  const { produtos, vendedores, admin } = props;
  const [busca, setBusca] = useState("");
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [vendedor, setVendedor] = useState(props.atorId);
  const [cliente, setCliente] = useState("");
  const [descTotal, setDescTotal] = useState("");
  const [data, setData] = useState(props.hoje);
  const [pagamentos, setPagamentos] = useState<Record<Forma, string>>({ pix: "", dinheiro: "", debito: "", credito: "" });
  const [chave, setChave] = useState(novaChave);
  const [resposta, setResposta] = useState<RespostaVenda | null>(null);
  const [confirmaMargem, setConfirmaMargem] = useState(false);
  const [autLogin, setAutLogin] = useState("");
  const [autSenha, setAutSenha] = useState("");
  const [enviando, iniciar] = useTransition();

  const filtrados = useMemo(() => {
    const t = busca.trim().toLocaleLowerCase("pt-BR").normalize("NFD").replace(/\p{M}/gu, "");
    const base = t ? produtos.filter((p) => p.nome.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/\p{M}/gu, "").includes(t)) : produtos;
    return base.slice(0, 40);
  }, [busca, produtos]);

  const retroativa = admin && data < props.hoje;
  const precoDe = (l: Linha) => (retroativa && l.preco.trim() ? centavos(l.preco) : l.produto.precoVendaCents);
  const subtotal = linhas.reduce((a, l) => a + (precoDe(l) || 0) * l.qtd, 0);
  const atualizar = (id: number, campo: "desconto" | "preco" | "custo" | "comissao", valor: string) =>
    setLinhas((ls) => ls.map((x) => (x.produto.id === id ? { ...x, [campo]: valor } : x)));
  const pct = (t: string) => { try { return parsePercentual(t); } catch { return NaN; } };
  const descItens = linhas.reduce((a, l) => a + (centavos(l.desconto) || 0), 0);
  const dTotal = centavos(descTotal) || 0;
  const total = subtotal - descItens - dTotal;
  const pago = FORMAS.reduce((a, f) => a + (centavos(pagamentos[f.id]) || 0), 0);
  const falta = total - pago;

  function adicionar(p: ProdutoPublico) {
    setResposta(null);
    setLinhas((ls) => {
      const i = ls.findIndex((l) => l.produto.id === p.id);
      if (i >= 0) return ls.map((l, k) => (k === i ? { ...l, qtd: l.qtd + 1 } : l));
      return [...ls, { produto: p, qtd: 1, desconto: "", preco: "", custo: "", comissao: "" }];
    });
  }
  const mudarQtd = (id: number, qtd: number) => setLinhas((ls) => ls.flatMap((l) => (l.produto.id !== id ? [l] : qtd <= 0 ? [] : [{ ...l, qtd }])));
  const preencherRestante = (f: Forma) => setPagamentos((p) => ({ ...p, [f]: ((Math.max(0, total - (pago - (centavos(p[f]) || 0)))) / 100).toFixed(2).replace(".", ",") }));

  function limpar() {
    setLinhas([]); setCliente(""); setDescTotal(""); setPagamentos({ pix: "", dinheiro: "", debito: "", credito: "" });
    setConfirmaMargem(false); setAutLogin(""); setAutSenha(""); setChave(novaChave()); setBusca("");
  }

  function finalizar() {
    const pags = FORMAS.map((f) => ({ forma: f.id, valorCents: centavos(pagamentos[f.id]) })).filter((p) => p.valorCents);
    const invalido = (l: Linha) => Number.isNaN(centavos(l.desconto)) || (retroativa && [centavos(l.preco), centavos(l.custo), pct(l.comissao)].some(Number.isNaN));
    if (pags.some((p) => Number.isNaN(p.valorCents)) || linhas.some(invalido) || Number.isNaN(dTotal)) {
      setResposta({ ok: false, erro: "Há um valor digitado incorretamente. Use o formato 12,50." });
      return;
    }
    iniciar(async () => {
      const r = await acaoRegistrarVenda({
        chaveIdempotencia: chave,
        colaboradorId: vendedor,
        cliente: cliente || undefined,
        dataEfetiva: admin ? data : undefined,
        itens: linhas.map((l) => {
          const item: { produtoId: number; quantidade: number; descontoCents: number; precoUnitarioCents?: number; custoUnitarioCents?: number; repasseUnitarioCents?: number; comissaoBps?: number } =
            { produtoId: l.produto.id, quantidade: l.qtd, descontoCents: centavos(l.desconto) || 0 };
          if (retroativa) {
            if (l.preco.trim()) item.precoUnitarioCents = centavos(l.preco);
            if (l.custo.trim()) {
              if (props.modalidades?.[l.produto.id] === "consignado") item.repasseUnitarioCents = centavos(l.custo);
              else item.custoUnitarioCents = centavos(l.custo);
            }
            if (l.comissao.trim()) item.comissaoBps = pct(l.comissao);
          }
          return item;
        }),
        descontoTotalCents: dTotal,
        pagamentos: pags,
        autorizarMargemNegativa: admin ? confirmaMargem : undefined,
        autorizacao: !admin && autLogin ? { login: autLogin, senha: autSenha } : undefined,
      });
      setResposta(r);
      if (r.ok) limpar();
    });
  }

  if (resposta?.ok) {
    return (
      <div className="cartao" style={{ textAlign: "center" }}>
        <div className="aviso ok">Venda #{resposta.vendaId} registrada{resposta.duplicada ? " (já havia sido gravada — nada foi duplicado)" : ""}.</div>
        <div className="acoes" style={{ justifyContent: "center" }}>
          <button className="btn amarelo" onClick={() => setResposta(null)}>＋ Nova venda</button>
          <Link className="btn" href={`/vendas/${resposta.vendaId}`}>Ver venda</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="pdv">
      <section className="cartao">
        <label htmlFor="busca">Buscar produto</label>
        <input id="busca" placeholder="Digite o nome…" value={busca} onChange={(e) => setBusca(e.target.value)} autoComplete="off" />
        <div style={{ marginTop: 12, maxHeight: 520, overflowY: "auto" }}>
          {filtrados.map((p) => (
            <button type="button" key={p.id} className="produto-btn" onClick={() => adicionar(p)}>
              <span><strong>{p.nome}</strong><br /><small>{p.categoria ?? "Sem categoria"} · {p.quantidade} em estoque {p.quantidade <= 0 && <span className="selo rosa">sem saldo</span>}</small></span>
              <strong className="num">{R(p.precoVendaCents)}</strong>
            </button>
          ))}
          {filtrados.length === 0 && <p className="suave">Nenhum produto encontrado.</p>}
        </div>
      </section>

      <section className="cartao carrinho">
        <h2>Itens</h2>
        {linhas.length === 0 && <p className="suave">Toque em um produto para adicionar.</p>}
        <ul className="lista">
          {linhas.map((l) => (
            <li key={l.produto.id} style={{ flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 160px" }}>
                <div className="principal">{l.produto.nome}</div>
                <small>{R(precoDe(l) || 0)} un.</small>
                {l.produto.quantidade - l.qtd < 0 && <div><span className="selo rosa">estoque ficará negativo</span></div>}
              </div>
              <div className="qtd">
                <button type="button" aria-label="Diminuir" onClick={() => mudarQtd(l.produto.id, l.qtd - 1)}>−</button>
                <input inputMode="numeric" value={l.qtd} onChange={(e) => mudarQtd(l.produto.id, parseInt(e.target.value || "0", 10) || 0)} aria-label="Quantidade" />
                <button type="button" aria-label="Aumentar" onClick={() => mudarQtd(l.produto.id, l.qtd + 1)}>+</button>
              </div>
              <strong className="num" style={{ minWidth: 90 }}>{R((precoDe(l) || 0) * l.qtd)}</strong>
              {admin && (
                <div style={{ flexBasis: "100%" }}>
                  <input placeholder="Desconto no item (R$)" inputMode="decimal" value={l.desconto} onChange={(e) => atualizar(l.produto.id, "desconto", e.target.value)} />
                  {retroativa && (
                    <div className="linha-campos" style={{ marginTop: 8 }}>
                      <div><label style={{ fontSize: "0.75rem" }}>Preço da época</label><input aria-label="Preço da época" placeholder={R(l.produto.precoVendaCents)} inputMode="decimal" value={l.preco} onChange={(e) => atualizar(l.produto.id, "preco", e.target.value)} /></div>
                      <div><label style={{ fontSize: "0.75rem" }}>{props.modalidades?.[l.produto.id] === "consignado" ? "Repasse da época" : "Custo da época"}</label><input aria-label="Custo ou repasse da época" placeholder="atual" inputMode="decimal" value={l.custo} onChange={(e) => atualizar(l.produto.id, "custo", e.target.value)} /></div>
                      <div><label style={{ fontSize: "0.75rem" }}>Comissão da época (%)</label><input aria-label="Comissão da época (%)" placeholder="atual" inputMode="decimal" value={l.comissao} onChange={(e) => atualizar(l.produto.id, "comissao", e.target.value)} /></div>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>

        <div className="linha-campos" style={{ marginTop: 12 }}>
          <div className="campo">
            <label>Colaborador responsável</label>
            <select value={vendedor} onChange={(e) => setVendedor(Number(e.target.value))} disabled={!admin}>
              {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
            </select>
          </div>
          <div className="campo"><label>Cliente (opcional)</label><input value={cliente} onChange={(e) => setCliente(e.target.value)} /></div>
        </div>
        {admin && (
          <div className="linha-campos">
            <div className="campo"><label>Desconto no total (R$)</label><input inputMode="decimal" value={descTotal} onChange={(e) => setDescTotal(e.target.value)} placeholder="0,00" /><div className="ajuda">Rateado proporcionalmente entre os itens.</div></div>
            <div className="campo"><label>Data da venda</label><input type="date" value={data} max={props.hoje} onChange={(e) => setData(e.target.value)} /><div className="ajuda">{retroativa ? "Venda retroativa: informe nos itens os valores da época (vazio = valor atual)." : "Datas anteriores: lançamento retroativo."}</div></div>
          </div>
        )}

        <div style={{ borderTop: "1px solid var(--linha)", paddingTop: 12, margin: "8px 0 12px" }}>
          <div className="acoes" style={{ justifyContent: "space-between" }}><span>Subtotal</span><span className="num">{R(subtotal)}</span></div>
          {(descItens > 0 || dTotal > 0) && <div className="acoes" style={{ justifyContent: "space-between" }}><span>Descontos</span><span className="num">−{R(descItens + dTotal)}</span></div>}
          <div className="acoes" style={{ justifyContent: "space-between", alignItems: "baseline" }}><strong>Total</strong><span className="total-grande">{R(total)}</span></div>
        </div>

        <h3>Pagamento</h3>
        {FORMAS.map((f) => (
          <div key={f.id} className="acoes" style={{ marginBottom: 8, flexWrap: "nowrap" }}>
            <label style={{ width: 80, margin: 0 }}>{f.rotulo}</label>
            <input inputMode="decimal" placeholder="0,00" value={pagamentos[f.id]} onChange={(e) => setPagamentos((p) => ({ ...p, [f.id]: e.target.value }))} />
            <button type="button" className="btn pequeno" onClick={() => preencherRestante(f.id)} title="Preencher com o valor que falta">restante</button>
          </div>
        ))}
        <p className={falta === 0 ? "suave" : ""} style={{ color: falta === 0 ? undefined : "var(--rosa-escuro)" }}>
          {falta === 0 ? "Pagamento confere com o total." : falta > 0 ? `Faltam ${R(falta)}` : `Pagamento excede o total em ${R(-falta)}`}
        </p>

        {resposta && !resposta.ok && (
          <div className="aviso erro" role="alert">
            {resposta.erro}
            {resposta.margemNegativa && <div style={{ marginTop: 6 }}>Itens abaixo do custo: {resposta.margemNegativa.map((m) => m.nome).join(", ")}</div>}
          </div>
        )}
        {resposta && !resposta.ok && resposta.margemNegativa && (admin ? (
          <label className="check aviso atencao"><input type="checkbox" checked={confirmaMargem} onChange={(e) => setConfirmaMargem(e.target.checked)} /> Autorizo esta venda com margem negativa</label>
        ) : (
          <div className="aviso atencao">
            <strong>Autorização de administrador</strong>
            <div className="linha-campos" style={{ marginTop: 8 }}>
              <input placeholder="Usuário do administrador" value={autLogin} onChange={(e) => setAutLogin(e.target.value)} autoCapitalize="none" />
              <input placeholder="Senha" type="password" value={autSenha} onChange={(e) => setAutSenha(e.target.value)} />
            </div>
          </div>
        ))}

        <button className="btn primario bloco" style={{ minHeight: 52, fontSize: "1.05rem" }} disabled={enviando || linhas.length === 0 || falta !== 0} onClick={finalizar}>
          {enviando ? "Registrando…" : `Concluir venda · ${R(total)}`}
        </button>
        {linhas.length > 0 && <button type="button" className="btn bloco" style={{ marginTop: 8 }} onClick={limpar}>Limpar</button>}
      </section>
    </div>
  );
}
