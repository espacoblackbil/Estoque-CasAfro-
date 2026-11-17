import { it } from "vitest";
import fs from "node:fs";
import { novoCenario } from "./helpers";
import { criarProduto, salvarFornecedor } from "@/server/services/cadastros";
import { corrigirMovimentacao, registrarEntrada, registrarSaida } from "@/server/services/estoque";
import { registrarVenda } from "@/server/services/vendas";
import { emitirRelatorio, obterPdf } from "@/server/services/relatorios";

it.skipIf(!process.env.AMOSTRA_PDF)("gera amostras de PDF", async () => {
  const c = await novoCenario();
  const f = await salvarFornecedor(c.db, c.admin, { nome: "Ayo Cosméticos", documento: "41.915.055/0001-09" });
  const o = (await criarProduto(c.db, c.admin, { nome: "Óleo de Coco 120ml", modalidade: "consignado", fornecedorId: f.id, precoVendaCents: 5000, repasseCents: 3000, comissaoBps: 1000 })).id;
  const m = (await criarProduto(c.db, c.admin, { nome: "Máscara Nutritiva 500g", modalidade: "proprio", precoVendaCents: 6000, comissaoBps: 500 })).id;
  await registrarEntrada(c.db, c.admin, { produtoId: o, quantidade: 30, dataEfetiva: "2026-09-01" });
  await registrarEntrada(c.db, c.admin, { produtoId: m, quantidade: 30, custoUnitarioCents: 2000, dataEfetiva: "2026-09-01" });
  for (let i = 1; i <= 12; i++) {
    await registrarVenda(c.db, c.admin, { chaveIdempotencia: `amostra-${i}-xyz`, colaboradorId: i % 2 ? c.colab.id : c.colab2.id, dataEfetiva: `2026-09-${String(i + 2).padStart(2, "0")}`,
      itens: [{ produtoId: o, quantidade: 1 }, { produtoId: m, quantidade: 1 }], pagamentos: [{ forma: i % 3 ? "pix" : "credito", valorCents: 11000 }] });
  }
  await registrarSaida(c.db, c.admin, { produtoId: o, tipo: "consumo_interno", quantidade: 2, dataEfetiva: "2026-09-10" });
  const d = await registrarSaida(c.db, c.admin, { produtoId: o, tipo: "dano", quantidade: 1, dataEfetiva: "2026-09-12" });
  await emitirRelatorio(c.db, c.admin, { tipo: "geral", periodo: { de: "2026-09-01", ate: "2026-09-30" } });
  await corrigirMovimentacao(c.db, c.admin, d.id, { quantidade: 2, dataEfetiva: "2026-09-12", justificativa: "Eram 2 frascos" });
  const out = process.env.AMOSTRA_PDF!;
  for (const [tipo, escopoId] of [["geral", 0], ["fornecedor", f.id], ["colaborador", c.colab.id], ["comissoes", 0]] as const) {
    const { emissao } = await emitirRelatorio(c.db, c.admin, { tipo, escopoId, periodo: { de: "2026-09-01", ate: "2026-09-30" } });
    fs.writeFileSync(`${out}/${tipo}.pdf`, (await obterPdf(c.db, c.admin, emissao.id)).pdf);
  }
});
