import { getDb } from "@/server/db";
import { executarAcao, exigirSessaoAdmin } from "@/server/sessao";
import { obterConfiguracoes, salvarConfiguracoes } from "@/server/services/configuracoes";
import { campo, inteiro, marcado } from "@/app/formularios";
import { Mensagens, lerParams, type BuscaParams } from "@/components/Mensagens";

async function acaoSalvar(fd: FormData) {
  "use server";
  const ator = await exigirSessaoAdmin();
  const db = await getDb();
  await executarAcao(async () => {
    let logotipo: string | undefined;
    const arq = fd.get("logotipo");
    if (marcado(fd, "removerLogo")) logotipo = "";
    else if (arq instanceof File && arq.size > 0) {
      if (!["image/png", "image/jpeg"].includes(arq.type)) throw new Error("Valor inválido: o logotipo deve ser PNG ou JPEG");
      logotipo = `data:${arq.type};base64,${Buffer.from(await arq.arrayBuffer()).toString("base64")}`;
    }
    await salvarConfiguracoes(db, ator, {
      nomeFantasia: campo(fd, "nomeFantasia"), razaoSocial: campo(fd, "razaoSocial"), cnpj: campo(fd, "cnpj"),
      endereco: campo(fd, "endereco"), telefone: campo(fd, "telefone"), estoqueMinimo: inteiro(fd, "estoqueMinimo"), logotipo,
    });
  }, "/configuracoes", "Configurações salvas. Os próximos relatórios já usarão estes dados.");
}

export default async function Configuracoes({ searchParams }: { searchParams: BuscaParams }) {
  await exigirSessaoAdmin();
  const { ok, erro } = await lerParams(searchParams);
  const c = await obterConfiguracoes(await getDb());
  return (
    <>
      <Mensagens ok={ok} erro={erro} />
      <div className="cabecalho-pagina"><h1>Configurações</h1></div>
      <form action={acaoSalvar} className="cartao">
        <h2>Dados da empresa (usados nos relatórios)</h2>
        <div className="linha-campos">
          <div className="campo"><label>Nome fantasia</label><input name="nomeFantasia" defaultValue={c.nomeFantasia} required /></div>
          <div className="campo"><label>Razão social</label><input name="razaoSocial" defaultValue={c.razaoSocial} /></div>
          <div className="campo"><label>CNPJ</label><input name="cnpj" defaultValue={c.cnpj} /></div>
        </div>
        <div className="linha-campos">
          <div className="campo"><label>Endereço</label><input name="endereco" defaultValue={c.endereco} /></div>
          <div className="campo"><label>Telefone</label><input name="telefone" defaultValue={c.telefone} /></div>
        </div>
        <h2 style={{ marginTop: 12 }}>Estoque</h2>
        <div className="campo" style={{ maxWidth: 260 }}><label>Estoque mínimo (todos os produtos)</label><input name="estoqueMinimo" type="number" min={0} defaultValue={c.estoqueMinimo} required /></div>
        <h2 style={{ marginTop: 12 }}>Logotipo</h2>
        <div style={{ background: "#111", padding: 12, borderRadius: 12, display: "inline-block", marginBottom: 8 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={c.logotipo || "/logo-casafro-header.jpg"} alt="Logotipo atual" style={{ height: 60 }} />
        </div>
        <div className="campo"><label>Enviar novo logotipo (PNG ou JPEG, até 1 MB)</label><input type="file" name="logotipo" accept="image/png,image/jpeg" /></div>
        {c.logotipo && <label className="check"><input type="checkbox" name="removerLogo" /> Voltar ao logotipo padrão</label>}
        <button className="btn primario" style={{ marginTop: 12 }}>Salvar configurações</button>
      </form>
    </>
  );
}
