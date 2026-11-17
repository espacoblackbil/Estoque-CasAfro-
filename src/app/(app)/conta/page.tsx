import { getDb } from "@/server/db";
import { executarAcao, exigirSessao } from "@/server/sessao";
import { alterarPropriaSenha } from "@/server/services/usuarios";
import { ErroNegocio } from "@/server/erros";
import { campo } from "@/app/formularios";
import { Mensagens, lerParams, type BuscaParams } from "@/components/Mensagens";

async function acaoSenha(fd: FormData) {
  "use server";
  const ator = await exigirSessao();
  const db = await getDb();
  await executarAcao(async () => {
    if (campo(fd, "nova") !== campo(fd, "nova2")) throw new ErroNegocio("As senhas novas não conferem.");
    await alterarPropriaSenha(db, ator, campo(fd, "atual"), campo(fd, "nova"));
  }, "/login", "Senha alterada. Entre novamente.");
}

export default async function Conta({ searchParams }: { searchParams: BuscaParams }) {
  const ator = await exigirSessao();
  const { ok, erro } = await lerParams(searchParams);
  return (
    <>
      <Mensagens ok={ok} erro={erro} />
      <div className="cabecalho-pagina"><h1>Minha conta</h1></div>
      <form action={acaoSenha} className="cartao" style={{ maxWidth: 460 }}>
        <p>{ator.nome}</p>
        <div className="campo"><label>Senha atual</label><input name="atual" type="password" required autoComplete="current-password" /></div>
        <div className="campo"><label>Nova senha</label><input name="nova" type="password" minLength={6} required autoComplete="new-password" /></div>
        <div className="campo"><label>Repita a nova senha</label><input name="nova2" type="password" minLength={6} required autoComplete="new-password" /></div>
        <button className="btn primario">Trocar senha</button>
      </form>
    </>
  );
}
