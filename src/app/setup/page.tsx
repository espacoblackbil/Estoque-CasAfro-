import { timingSafeEqual } from "node:crypto";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db";
import { mensagemDeErro } from "@/server/sessao";
import { criarPrincipalInicial, sistemaConfigurado } from "@/server/services/usuarios";
import { Mensagens, lerParams, type BuscaParams } from "@/components/Mensagens";

export const dynamic = "force-dynamic";

function tokenConfere(informado: string) {
  const esperado = process.env.SETUP_TOKEN ?? "";
  if (!esperado) return process.env.NODE_ENV !== "production"; // em produção o token é obrigatório
  const a = Buffer.from(informado);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function acaoConfigurar(fd: FormData) {
  "use server";
  let destino = "/login?ok=" + encodeURIComponent("Conta criada. Entre com o usuário e a senha definidos.");
  try {
    if (!tokenConfere(String(fd.get("token") ?? ""))) throw new Error("token");
    if (fd.get("senha") !== fd.get("senha2")) throw new Error("senhas");
    await criarPrincipalInicial(await getDb(), {
      nome: String(fd.get("nome") ?? ""),
      login: String(fd.get("login") ?? ""),
      senha: String(fd.get("senha") ?? ""),
    });
  } catch (e) {
    const msg = e instanceof Error && e.message === "token" ? "Token de configuração inválido."
      : e instanceof Error && e.message === "senhas" ? "As senhas não conferem."
      : mensagemDeErro(e) ?? "Não foi possível configurar.";
    destino = "/setup?erro=" + encodeURIComponent(msg);
  }
  redirect(destino);
}

export default async function Setup({ searchParams }: { searchParams: BuscaParams }) {
  if (await sistemaConfigurado(await getDb())) redirect("/login");
  const { erro } = await lerParams(searchParams);
  return (
    <main className="login">
      <div className="cartao">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="marca" src="/logo-casafro-header.jpg" alt="CasAfro" />
        <div className="faixas" />
        <h1>Primeiro acesso</h1>
        <p className="suave">Crie a conta do administrador principal. Esta tela só funciona enquanto não houver usuários.</p>
        <Mensagens erro={erro} />
        <form action={acaoConfigurar}>
          <div className="campo"><label>Token de configuração</label><input name="token" type="password" autoComplete="off" /><div className="ajuda">Valor da variável SETUP_TOKEN do servidor.</div></div>
          <div className="campo"><label>Nome</label><input name="nome" required /></div>
          <div className="campo"><label>Usuário</label><input name="login" autoCapitalize="none" required /></div>
          <div className="campo"><label>Senha</label><input name="senha" type="password" minLength={6} required /></div>
          <div className="campo"><label>Confirme a senha</label><input name="senha2" type="password" minLength={6} required /></div>
          <button className="btn primario bloco">Criar administrador principal</button>
        </form>
      </div>
    </main>
  );
}
