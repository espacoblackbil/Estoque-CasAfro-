import { formatarPercentual } from "@/domain/money";

type Produto = {
  nome: string; categoriaId: number | null; fornecedorId: number | null; modalidade: "proprio" | "consignado";
  precoVendaCents: number; custoMedioCents: number; repasseCents: number; comissaoBps: number; ativo: boolean;
};

const reais = (c: number) => (c / 100).toFixed(2).replace(".", ",");

export function ProdutoForm(props: {
  acao: (fd: FormData) => Promise<void>;
  categorias: { id: number; nome: string }[];
  fornecedores: { id: number; nome: string }[];
  produto?: Produto & { id: number };
  temMovimentacoes?: boolean;
}) {
  const p = props.produto;
  return (
    <form action={props.acao} className="cartao">
      {p && <input type="hidden" name="id" value={p.id} />}
      <div className="campo"><label>Nome</label><input name="nome" defaultValue={p?.nome} required /></div>
      <div className="linha-campos">
        <div className="campo"><label>Categoria</label>
          <select name="categoriaId" defaultValue={p?.categoriaId ?? ""}><option value="">—</option>{props.categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select>
        </div>
        <div className="campo"><label>Fornecedor</label>
          <select name="fornecedorId" defaultValue={p?.fornecedorId ?? ""}><option value="">—</option>{props.fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}</select>
          <div className="ajuda">Obrigatório para consignados.</div>
        </div>
      </div>
      <div className="linha-campos">
        <div className="campo"><label>Modalidade</label>
          <select name="modalidade" defaultValue={p?.modalidade ?? "proprio"} disabled={props.temMovimentacoes}>
            <option value="proprio">Próprio (custo médio)</option>
            <option value="consignado">Consignado (repasse fixo)</option>
          </select>
          {props.temMovimentacoes && <><input type="hidden" name="modalidade" value={p?.modalidade} /><div className="ajuda">Não muda após haver movimentações.</div></>}
        </div>
        <div className="campo"><label>Preço de venda (R$)</label><input name="preco" inputMode="decimal" defaultValue={p ? reais(p.precoVendaCents) : ""} required /></div>
      </div>
      <div className="linha-campos">
        <div className="campo"><label>Custo (R$) — próprio</label><input name="custo" inputMode="decimal" defaultValue={p ? reais(p.custoMedioCents) : ""} /><div className="ajuda">Custo médio: atualizado pelas entradas. Alterar à mão exige justificativa.</div></div>
        <div className="campo"><label>Repasse por unidade (R$) — consignado</label><input name="repasse" inputMode="decimal" defaultValue={p ? reais(p.repasseCents) : ""} /></div>
        <div className="campo"><label>Comissão de venda (%)</label><input name="comissao" inputMode="decimal" defaultValue={p ? formatarPercentual(p.comissaoBps).replace("%", "") : ""} placeholder="0" /><div className="ajuda">Igual para todos os colaboradores. Vazio = 0%.</div></div>
      </div>
      {p && <div className="campo"><label>Justificativa da alteração</label><input name="justificativa" placeholder="Obrigatória ao alterar o custo manualmente" /></div>}
      <label className="check"><input type="checkbox" name="ativo" defaultChecked={p?.ativo ?? true} /> Produto ativo</label>
      <p className="suave" style={{ fontSize: "0.8rem", marginTop: 8 }}>Mudanças de preço, repasse ou comissão valem para as próximas vendas; as vendas passadas mantêm os valores da época.</p>
      <button className="btn primario" style={{ marginTop: 8 }}>{p ? "Salvar alterações" : "Cadastrar produto"}</button>
    </form>
  );
}
