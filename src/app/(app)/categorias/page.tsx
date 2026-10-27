import { getDb } from "@/server/db";
import { executarAcao, exigirSessaoAdmin } from "@/server/sessao";
import { listarCategorias, salvarCategoria } from "@/server/services/cadastros";
import { campo, inteiroOpcional, marcado } from "@/app/formularios";
import { Mensagens, lerParams, type BuscaParams } from "@/components/Mensagens";

async function acaoSalvar(fd: FormData) {
  "use server";
  const ator = await exigirSessaoAdmin();
  const db = await getDb();
  const id = fd.get("id") ? Number(fd.get("id")) : undefined;
  await executarAcao(() => salvarCategoria(db, ator, { nome: campo(fd, "nome"), ordem: inteiroOpcional(fd, "ordem") ?? 0, ativo: id ? marcado(fd, "ativo") : true }, id), "/categorias", "Categoria salva.");
}

export default async function Categorias({ searchParams }: { searchParams: BuscaParams }) {
  await exigirSessaoAdmin();
  const { ok, erro } = await lerParams(searchParams);
  const lista = await listarCategorias(await getDb());
  return (
    <>
      <Mensagens ok={ok} erro={erro} />
      <div className="cabecalho-pagina"><h1>Categorias</h1></div>
      <form action={acaoSalvar} className="cartao acoes">
        <input name="nome" placeholder="Nova categoria (ex.: Bebidas)" required style={{ flex: "1 1 200px" }} />
        <input name="ordem" type="number" placeholder="Ordem" style={{ width: 100 }} />
        <button className="btn primario">Adicionar</button>
      </form>
      <section className="cartao">
        <ul className="lista">
          {lista.map((c) => (
            <li key={c.id}>
              <form action={acaoSalvar} className="acoes" style={{ width: "100%" }}>
                <input type="hidden" name="id" value={c.id} />
                <input name="nome" defaultValue={c.nome} required style={{ flex: "1 1 160px" }} />
                <input name="ordem" type="number" defaultValue={c.ordem} style={{ width: 90 }} aria-label="Ordem" />
                <label className="check"><input type="checkbox" name="ativo" defaultChecked={c.ativo} /> ativa</label>
                <button className="btn pequeno">Salvar</button>
              </form>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
