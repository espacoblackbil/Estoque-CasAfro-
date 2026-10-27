import { getDb } from "@/server/db";
import { executarAcao, exigirSessaoAdmin } from "@/server/sessao";
import { criarUsuario, editarUsuario, listarUsuarios } from "@/server/services/usuarios";
import type { Papel } from "@/server/services/permissoes";
import { campo, campoOpcional, marcado } from "@/app/formularios";
import { Mensagens, lerParams, type BuscaParams } from "@/components/Mensagens";

const PAPEL: Record<Papel, string> = { principal: "Administrador principal", admin: "Administrador", colaborador: "Colaborador" };

async function acaoCriar(fd: FormData) {
  "use server";
  const ator = await exigirSessaoAdmin();
  const db = await getDb();
  await executarAcao(() => criarUsuario(db, ator, { nome: campo(fd, "nome"), login: campo(fd, "login"), senha: campo(fd, "senha"), papel: campo(fd, "papel") as Papel }), "/usuarios", "Usuário criado. Informe o login e a senha inicial à pessoa.");
}

async function acaoEditar(fd: FormData) {
  "use server";
  const ator = await exigirSessaoAdmin();
  const db = await getDb();
  await executarAcao(() => editarUsuario(db, ator, Number(fd.get("id")), {
    nome: campo(fd, "nome"), papel: campo(fd, "papel") as Papel, ativo: marcado(fd, "ativo"), novaSenha: campoOpcional(fd, "novaSenha"),
  }, campoOpcional(fd, "justificativa")), "/usuarios", "Usuário atualizado.");
}

export default async function Usuarios({ searchParams }: { searchParams: BuscaParams }) {
  const ator = await exigirSessaoAdmin();
  const { ok, erro } = await lerParams(searchParams);
  const lista = await listarUsuarios(await getDb(), ator);
  const papeisPermitidos: Papel[] = ator.papel === "principal" ? ["admin", "colaborador"] : ["colaborador"];
  return (
    <>
      <Mensagens ok={ok} erro={erro} />
      <div className="cabecalho-pagina"><div><h1>Usuários e permissões</h1><p className="suave">{ator.papel === "principal" ? "Você gerencia administradores e colaboradores." : "Administradores cadastram e gerenciam colaboradores."}</p></div></div>
      <details>
        <summary>＋ Novo usuário</summary>
        <form action={acaoCriar}>
          <div className="linha-campos">
            <div className="campo"><label>Nome</label><input name="nome" required /></div>
            <div className="campo"><label>Usuário (login)</label><input name="login" autoCapitalize="none" required /></div>
            <div className="campo"><label>Senha inicial</label><input name="senha" type="password" minLength={6} required autoComplete="new-password" /></div>
            <div className="campo"><label>Perfil</label><select name="papel">{papeisPermitidos.map((p) => <option key={p} value={p}>{PAPEL[p]}</option>)}</select></div>
          </div>
          <button className="btn primario">Criar usuário</button>
        </form>
      </details>
      <section className="cartao">
        <ul className="lista">
          {lista.map((u) => {
            const pode = ator.papel === "principal" ? u.papel !== "principal" : u.papel === "colaborador";
            return (
              <li key={u.id} style={{ display: "block" }}>
                <details style={{ border: 0, padding: 0, margin: 0 }}>
                  <summary><span className="principal">{u.nome}</span> <span className="selo">{PAPEL[u.papel]}</span> {!u.ativo && <span className="selo rosa">inativo</span>}<br /><small>login: {u.login}</small></summary>
                  {pode ? (
                    <form action={acaoEditar}>
                      <input type="hidden" name="id" value={u.id} />
                      <div className="linha-campos">
                        <div className="campo"><label>Nome</label><input name="nome" defaultValue={u.nome} required /></div>
                        <div className="campo"><label>Perfil</label><select name="papel" defaultValue={u.papel}>{papeisPermitidos.map((p) => <option key={p} value={p}>{PAPEL[p]}</option>)}</select></div>
                        <div className="campo"><label>Nova senha (opcional)</label><input name="novaSenha" type="password" minLength={6} autoComplete="new-password" /></div>
                      </div>
                      <div className="campo"><label>Justificativa</label><input name="justificativa" /></div>
                      <label className="check"><input type="checkbox" name="ativo" defaultChecked={u.ativo} /> Ativo (inativo não consegue entrar)</label>
                      <button className="btn" style={{ marginTop: 8 }}>Salvar</button>
                    </form>
                  ) : <p className="suave">Você não pode alterar esta conta.</p>}
                </details>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
