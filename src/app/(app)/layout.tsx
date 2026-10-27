import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db";
import { COOKIE_SESSAO, exigirSessao } from "@/server/sessao";
import { sair } from "@/server/services/usuarios";
import { ehAdmin } from "@/server/services/permissoes";
import { Nav } from "@/components/Nav";

export const dynamic = "force-dynamic";

async function acaoSair() {
  "use server";
  const jar = await cookies();
  const token = jar.get(COOKIE_SESSAO)?.value;
  if (token) await sair(await getDb(), token);
  jar.delete(COOKIE_SESSAO);
  redirect("/login");
}

export default async function LayoutApp({ children }: { children: React.ReactNode }) {
  const ator = await exigirSessao();
  const papel = ator.papel === "principal" ? "Administrador principal" : ator.papel === "admin" ? "Administrador" : "Colaborador";
  return (
    <div className="app">
      <header className="topo">
        <Link href="/" aria-label="Início">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-casafro-header.jpg" alt="CasAfro" />
        </Link>
        <div className="usuario">
          <div><strong>{ator.nome}</strong> · {papel}</div>
          <form action={acaoSair} style={{ display: "inline" }}>
            <Link href="/conta">Minha conta</Link> · <button type="submit" style={{ background: "none", border: 0, color: "var(--amarelo)", font: "inherit", cursor: "pointer", padding: 0 }}>Sair</button>
          </form>
        </div>
      </header>
      <Nav admin={ehAdmin(ator)} />
      <main className="conteudo">{children}</main>
    </div>
  );
}
