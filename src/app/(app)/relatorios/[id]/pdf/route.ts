import { getDb } from "@/server/db";
import { obterAtor } from "@/server/sessao";
import { obterPdf } from "@/server/services/relatorios";
import { ehAdmin } from "@/server/services/permissoes";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ator = await obterAtor();
  if (!ator || !ehAdmin(ator)) return new Response("Acesso negado", { status: 403 });
  try {
    const { nome, pdf } = await obterPdf(await getDb(), ator, Number((await params).id));
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${nome}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return new Response("Relatório não encontrado", { status: 404 });
  }
}
