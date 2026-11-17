import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db";
import { COOKIE_SESSAO, mensagemDeErro } from "@/server/sessao";
import { entrar, sistemaConfigurado } from "@/server/services/usuarios";
import { Mensagens, lerParams, type BuscaParams } from "@/components/Mensagens";

export const dynamic = "force-dynamic";

async function acaoEntrar(fd: FormData) {
  "use server";
  let destino = "/";
  try {
    const s = await entrar(await getDb(), String(fd.get("login") ?? ""), String(fd.get("senha") ?? ""));
    (await cookies()).set(COOKIE_SESSAO, s.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: s.expiraEm,
    });
  } catch (e) {
    destino = "/login?erro=" + encodeURIComponent(mensagemDeErro(e) ?? "Não foi possível entrar.");
  }
  redirect(destino);
}

export default async function Login({ searchParams }: { searchParams: BuscaParams }) {
  if (!(await sistemaConfigurado(await getDb()))) redirect("/setup");
  const { erro, ok } = await lerParams(searchParams);
  return (
    <main className="login">
      <div className="cartao">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="marca" src="/logo-casafro-header.jpg" alt="CasAfro" />
        <div className="faixas" />
        <h1 style={{ textAlign: "center" }}>CasAfro Gestão</h1>
        <p className="suave" style={{ textAlign: "center" }}>Entre com seu usuário</p>
        <Mensagens erro={erro} ok={ok} />
        <form action={acaoEntrar}>
          <div className="campo"><label htmlFor="login">Usuário</label><input id="login" name="login" autoComplete="username" autoCapitalize="none" required /></div>
          <div className="campo"><label htmlFor="senha">Senha</label><input id="senha" name="senha" type="password" autoComplete="current-password" required /></div>
          <button className="btn primario bloco" type="submit">Entrar</button>
        </form>
      </div>
    </main>
  );
}
