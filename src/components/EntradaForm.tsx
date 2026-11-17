"use client";
import { useState } from "react";
import { arred, formatarBRL as R, parseBRL } from "@/domain/money";

interface ProdutoEntrada {
  id: number; nome: string; modalidade: "proprio" | "consignado"; quantidade: number;
  custoMedioCents: number; repasseCents: number; pendenteQtd: number; ativo: boolean;
}

const reais = (c: number) => (c / 100).toFixed(2).replace(".", ",");
const centavos = (t: string) => { try { return t.trim() ? parseBRL(t) : null; } catch { return NaN; } };

/** Entrada de mercadoria: o custo por unidade já vem do cadastro e a tela mostra o efeito no custo médio. */
export function EntradaForm(props: { acao: (fd: FormData) => Promise<void>; produtos: ProdutoEntrada[]; produtoInicial?: number; hoje: string }) {
  const inicial = props.produtos.find((p) => p.id === props.produtoInicial);
  const [produtoId, setProdutoId] = useState(inicial ? String(inicial.id) : "");
  const [qtd, setQtd] = useState("");
  const [custo, setCusto] = useState(inicial && inicial.modalidade === "proprio" && inicial.custoMedioCents ? reais(inicial.custoMedioCents) : "");
  const p = props.produtos.find((x) => String(x.id) === produtoId);
  const proprio = p?.modalidade === "proprio";

  function escolher(id: string) {
    setProdutoId(id);
    const novo = props.produtos.find((x) => String(x.id) === id);
    setCusto(novo && novo.modalidade === "proprio" && novo.custoMedioCents ? reais(novo.custoMedioCents) : "");
  }

  // Prévia com a mesma regra do servidor (custo médio ponderado sobre o saldo positivo).
  const n = parseInt(qtd || "0", 10) || 0;
  const c = centavos(custo);
  let previa: { total: number; medio: number } | null = null;
  if (p && proprio && n > 0 && c !== null && !Number.isNaN(c)) {
    const saldo = Math.max(p.quantidade, 0);
    const restantes = n - Math.min(n, Math.max(-p.quantidade, 0));
    const medio = restantes > 0 ? arred(saldo * p.custoMedioCents + restantes * c, saldo + restantes) : p.custoMedioCents;
    previa = { total: n * c, medio };
  }

  return (
    <form action={props.acao}>
      <div className="campo"><label>Produto</label>
        <select name="produtoId" value={produtoId} onChange={(e) => escolher(e.target.value)} required>
          <option value="" disabled>Selecione…</option>
          {props.produtos.map((x) => <option key={x.id} value={x.id}>{x.nome} ({x.modalidade === "consignado" ? "consig." : "próprio"} · {x.quantidade} un){x.ativo ? "" : " — INATIVO"}</option>)}
        </select>
      </div>
      {p && !p.ativo && <div className="aviso atencao">Este produto está <strong>inativo</strong>: não aparece na lista de Produtos nem na tela de venda. Para reativar, abra o produto e marque "Produto ativo".</div>}
      <div className="linha-campos">
        <div className="campo"><label>Quantidade</label><input name="quantidade" type="number" min={1} inputMode="numeric" required value={qtd} onChange={(e) => setQtd(e.target.value)} /></div>
        {proprio ? (
          <div className="campo">
            <label>Custo por UNIDADE (R$)</label>
            <input name="custo" inputMode="decimal" value={custo} onChange={(e) => setCusto(e.target.value)} placeholder="0,00" required />
            <div className="ajuda">Já vem com o custo do cadastro. Altere só se esta compra teve outro preço por unidade — não use o total da nota.</div>
          </div>
        ) : p ? (
          <div className="campo"><label>Repasse por unidade</label><input value={R(p.repasseCents)} disabled /><div className="ajuda">Consignado: o valor vem do cadastro do produto e não muda na entrada.</div></div>
        ) : null}
        <div className="campo"><label>Data efetiva</label><input type="date" name="data" defaultValue={props.hoje} max={props.hoje} /></div>
      </div>
      {previa && (
        <div className="aviso atencao">
          Total desta entrada: <strong>{n} × {R(c!)} = {R(previa.total)}</strong><br />
          Custo médio {previa.medio === p!.custoMedioCents ? "continua" : "ficará"}: <strong>{R(previa.medio)}</strong>
          {previa.medio !== p!.custoMedioCents && <> (hoje: {R(p!.custoMedioCents)})</>}
        </div>
      )}
      {c !== null && Number.isNaN(c) && <div className="aviso erro">Custo inválido. Use o formato 12,50.</div>}
      <div className="campo"><label>Observação</label><input name="justificativa" placeholder="Ex.: nota 123" /></div>
      <button className="btn primario">Registrar entrada</button>
    </form>
  );
}
