"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface Item { href: string; rotulo: string; ico: string; classe?: string }

export function Nav({ admin }: { admin: boolean }) {
  const caminho = usePathname();
  const itens: Item[] = admin
    ? [
        { href: "/", rotulo: "Início", ico: "◎" },
        { href: "/vender", rotulo: "Vender", ico: "＋", classe: "vender" },
        { href: "/produtos", rotulo: "Produtos", ico: "▦" },
        { href: "/estoque", rotulo: "Estoque", ico: "⇅" },
        { href: "/menu", rotulo: "Mais", ico: "☰", classe: "so-celular" },
        { href: "/vendas", rotulo: "Vendas", ico: "≡", classe: "so-desktop" },
        { href: "/comissoes", rotulo: "Comissões", ico: "％", classe: "so-desktop" },
        { href: "/relatorios", rotulo: "Relatórios", ico: "⎙", classe: "so-desktop" },
        { href: "/fornecedores", rotulo: "Fornecedores", ico: "◇", classe: "so-desktop" },
        { href: "/categorias", rotulo: "Categorias", ico: "◫", classe: "so-desktop" },
        { href: "/auditoria", rotulo: "Auditoria", ico: "◷", classe: "so-desktop" },
        { href: "/usuarios", rotulo: "Usuários", ico: "◉", classe: "so-desktop" },
        { href: "/configuracoes", rotulo: "Configurações", ico: "⚙", classe: "so-desktop" },
      ]
    : [
        { href: "/", rotulo: "Início", ico: "◎" },
        { href: "/vender", rotulo: "Vender", ico: "＋", classe: "vender" },
        { href: "/produtos", rotulo: "Produtos", ico: "▦" },
        { href: "/vendas", rotulo: "Vendas", ico: "≡" },
        { href: "/comissoes", rotulo: "Comissões", ico: "％" },
      ];
  const ativo = (h: string) => (h === "/" ? caminho === "/" : caminho.startsWith(h));
  return (
    <nav className="nav" aria-label="Navegação principal">
      {itens.map((i) => (
        <Link key={i.href} href={i.href} className={`${i.classe ?? ""} ${ativo(i.href) ? "ativo" : ""}`}>
          <span className="ico" aria-hidden>{i.ico}</span>
          {i.rotulo}
        </Link>
      ))}
    </nav>
  );
}
