"use client";
import { startTransition, useActionState, useState } from "react";
import { formatarPercentual } from "@/domain/money";
import { acaoSalvarProduto } from "@/app/(app)/produtos/acoes";

type Produto = {
  id: number; nome: string; categoriaId: number | null; fornecedorId: number | null; modalidade: "proprio" | "consignado";
  precoVendaCents: number; custoMedioCents: number; repasseCents: number; comissaoBps: number; ativo: boolean; quantidade: number;
};

const reais = (c: number) => (c / 100).toFixed(2).replace(".", ",");

export function ProdutoForm(props: {
  categorias: { id: number; nome: string }[];
  fornecedores: { id: number; nome: string }[];
  produto?: Produto;
  /** Motivo pelo qual a modalidade não pode ser trocada agora (null = pode). */
  bloqueioModalidade?: string | null;
}) {
  const p = props.produto;
  const [estado, enviar, enviando] = useActionState(acaoSalvarProduto, null);
  // Campos controlados: nada se perde quando o servidor devolve um erro.
  const [v, setV] = useState({
    nome: p?.nome ?? "",
    categoriaId: p?.categoriaId ? String(p.categoriaId) : "",
    fornecedorId: p?.fornecedorId ? String(p.fornecedorId) : "",
    modalidade: p?.modalidade ?? "proprio",
    preco: p ? reais(p.precoVendaCents) : "",
    valor: p ? reais(p.modalidade === "proprio" ? p.custoMedioCents : p.repasseCents) : "",
    comissao: p ? formatarPercentual(p.comissaoBps).replace("%", "") : "",
    justificativa: "",
    ativo: p?.ativo ?? true,
  });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setV((x) => ({ ...x, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value }));
  const consignado = v.modalidade === "consignado";
  const trocouModalidade = !!p && v.modalidade !== p.modalidade;
  const custoMudou = !!p && !trocouModalidade && !consignado && v.valor !== reais(p.custoMedioCents);

  return (
    <form
      className="cartao"
      onSubmit={(e) => {
        // envio manual: evita que o React limpe o formulário (inclusive os seletores) após um erro
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => enviar(fd));
      }}
    >
      {p && <input type="hidden" name="id" value={p.id} />}
      {estado?.erro && <div className="aviso erro" role="alert">{estado.erro}</div>}
      <div className="campo"><label>Nome</label><input name="nome" value={v.nome} onChange={set("nome")} required /></div>

      <div className="campo">
        <label>Modalidade</label>
        <select name="modalidade" value={v.modalidade} onChange={set("modalidade")} disabled={!!props.bloqueioModalidade}>
          <option value="proprio">Próprio — comprado pela CasAfro (custo médio)</option>
          <option value="consignado">Consignado — do fornecedor (repasse por unidade)</option>
        </select>
        {props.bloqueioModalidade && <><input type="hidden" name="modalidade" value={v.modalidade} /><div className="ajuda">{props.bloqueioModalidade}</div></>}
        {trocouModalidade && <div className="aviso atencao" style={{ marginTop: 8, marginBottom: 0 }}>Trocar a modalidade é uma correção de cadastro: as vendas e movimentações já registradas continuam com a modalidade antiga. Informe a justificativa abaixo.</div>}
      </div>

      <div className="linha-campos">
        <div className="campo"><label>Categoria</label>
          <select name="categoriaId" value={v.categoriaId} onChange={set("categoriaId")}><option value="">—</option>{props.categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select>
        </div>
        <div className="campo"><label>Fornecedor{consignado ? " (obrigatório)" : ""}</label>
          <select name="fornecedorId" value={v.fornecedorId} onChange={set("fornecedorId")} required={consignado}><option value="">—</option>{props.fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}</select>
        </div>
      </div>

      <div className="linha-campos">
        <div className="campo"><label>Preço de venda (R$)</label><input name="preco" inputMode="decimal" value={v.preco} onChange={set("preco")} required placeholder="0,00" /></div>
        <div className="campo">
          <label>{consignado ? "Repasse ao fornecedor por unidade (R$)" : "Custo unitário (R$)"}</label>
          <input name="valor" inputMode="decimal" value={v.valor} onChange={set("valor")} required={consignado} placeholder="0,00" />
          <div className="ajuda">{consignado ? "Quanto a CasAfro deve ao fornecedor por unidade vendida, usada ou perdida." : "Depois é atualizado pelo custo médio das entradas."}</div>
        </div>
        <div className="campo"><label>Comissão de venda (%)</label><input name="comissao" inputMode="decimal" value={v.comissao} onChange={set("comissao")} placeholder="0" /><div className="ajuda">Igual para todos os colaboradores. Vazio = 0%.</div></div>
      </div>

      {p && (trocouModalidade || custoMudou) && (
        <div className="campo"><label>Justificativa da alteração (obrigatória)</label><input name="justificativa" value={v.justificativa} onChange={set("justificativa")} required minLength={3} /></div>
      )}
      <label className="check"><input type="checkbox" name="ativo" checked={v.ativo} onChange={set("ativo")} /> Produto ativo</label>
      <p className="suave" style={{ fontSize: "0.8rem", marginTop: 8 }}>Mudanças de preço, repasse ou comissão valem para as próximas vendas; as vendas passadas mantêm os valores da época.</p>
      <button className="btn primario" style={{ marginTop: 8 }} disabled={enviando}>{enviando ? "Salvando…" : p ? "Salvar alterações" : "Cadastrar produto"}</button>
    </form>
  );
}
