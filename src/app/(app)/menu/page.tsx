import Link from "next/link";
import { exigirSessaoAdmin } from "@/server/sessao";

const GRUPOS = [
  { titulo: "Operação", itens: [["/vendas", "Vendas", "Histórico, cancelamentos e devoluções"], ["/estoque", "Estoque", "Entradas, saídas, inventário e correções"], ["/comissoes", "Comissões", "Saldos, pagamentos e extratos"]] },
  { titulo: "Cadastros", itens: [["/produtos", "Produtos", "Preços, custos, repasses e comissões"], ["/fornecedores", "Fornecedores", "Consignantes e distribuidores"], ["/categorias", "Categorias", "Organização dos produtos"]] },
  { titulo: "Fechamento", itens: [["/relatorios", "Central de Relatórios", "PDFs do mês, fornecedores e colaboradores"], ["/auditoria", "Auditoria", "Quem alterou o quê e por quê"]] },
  { titulo: "Administração", itens: [["/usuarios", "Usuários e permissões", "Administradores e colaboradores"], ["/configuracoes", "Configurações", "Dados da empresa, logotipo e estoque mínimo"]] },
];

export default async function Menu() {
  await exigirSessaoAdmin();
  return (
    <>
      <div className="cabecalho-pagina"><h1>Menu</h1></div>
      {GRUPOS.map((g) => (
        <section className="cartao" key={g.titulo}>
          <h2>{g.titulo}</h2>
          <ul className="lista">
            {g.itens.map(([href, rotulo, desc]) => (
              <li key={href}><Link href={href}><span className="principal">{rotulo}</span><br /><small>{desc}</small></Link><span aria-hidden>›</span></li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
