import { getDb } from "@/server/db";
import { executarAcao, exigirSessaoAdmin } from "@/server/sessao";
import { listarFornecedores, salvarFornecedor } from "@/server/services/cadastros";
import { campo, marcado } from "@/app/formularios";
import { Mensagens, lerParams, type BuscaParams } from "@/components/Mensagens";

async function acaoSalvar(fd: FormData) {
  "use server";
  const ator = await exigirSessaoAdmin();
  const db = await getDb();
  const id = fd.get("id") ? Number(fd.get("id")) : undefined;
  await executarAcao(() => salvarFornecedor(db, ator, { nome: campo(fd, "nome"), documento: campo(fd, "documento"), telefone: campo(fd, "telefone"), ativo: id ? marcado(fd, "ativo") : true }, id), "/fornecedores", "Fornecedor salvo.");
}

export default async function Fornecedores({ searchParams }: { searchParams: BuscaParams }) {
  const ator = await exigirSessaoAdmin();
  const { ok, erro } = await lerParams(searchParams);
  const lista = await listarFornecedores(await getDb(), ator);
  return (
    <>
      <Mensagens ok={ok} erro={erro} />
      <div className="cabecalho-pagina"><h1>Fornecedores</h1></div>
      <details open={lista.length === 0}>
        <summary>＋ Novo fornecedor</summary>
        <form action={acaoSalvar}>
          <div className="campo"><label>Nome</label><input name="nome" required /></div>
          <div className="linha-campos">
            <div className="campo"><label>CPF ou CNPJ</label><input name="documento" inputMode="numeric" /></div>
            <div className="campo"><label>Telefone</label><input name="telefone" inputMode="tel" /></div>
          </div>
          <button className="btn primario">Cadastrar</button>
        </form>
      </details>
      <section className="cartao">
        <ul className="lista">
          {lista.map((f) => (
            <li key={f.id} style={{ display: "block" }}>
              <details style={{ border: 0, padding: 0, margin: 0 }}>
                <summary><span className="principal">{f.nome}</span> {!f.ativo && <span className="selo">inativo</span>}<br /><small>{[f.documento, f.telefone].filter(Boolean).join(" · ") || "—"}</small></summary>
                <form action={acaoSalvar}>
                  <input type="hidden" name="id" value={f.id} />
                  <div className="campo"><label>Nome</label><input name="nome" defaultValue={f.nome} required /></div>
                  <div className="linha-campos">
                    <div className="campo"><label>CPF ou CNPJ</label><input name="documento" defaultValue={f.documento} /></div>
                    <div className="campo"><label>Telefone</label><input name="telefone" defaultValue={f.telefone} /></div>
                  </div>
                  <label className="check"><input type="checkbox" name="ativo" defaultChecked={f.ativo} /> Ativo</label>
                  <button className="btn" style={{ marginTop: 8 }}>Salvar</button>
                </form>
              </details>
            </li>
          ))}
          {lista.length === 0 && <li className="suave">Nenhum fornecedor cadastrado.</li>}
        </ul>
      </section>
    </>
  );
}
