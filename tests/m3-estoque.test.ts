import { describe, it, expect, beforeAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import { novoCenario, type Cenario } from "./helpers";
import { criarProduto, salvarFornecedor } from "@/server/services/cadastros";
import {
  ajustarInventario, anularMovimentacao, corrigirMovimentacao, definirSaldoInicial, listarMovimentacoes,
  registrarEntrada, registrarSaida, verificarConsistencia,
} from "@/server/services/estoque";
import { movimentacoes, produtos } from "@/server/db/schema";
import { listarAuditoria } from "@/server/services/auditoria";

describe("M3 · estoque", () => {
  let c: Cenario;
  let fornId: number;
  const prod = async (id: number) => (await c.db.select().from(produtos).where(eq(produtos.id, id)))[0];

  beforeAll(async () => {
    c = await novoCenario();
    fornId = (await salvarFornecedor(c.db, c.admin, { nome: "Fornecedora Ayo", documento: "41.915.055/0001-09" })).id;
  });

  it("entradas calculam custo médio ponderado", async () => {
    const p = await criarProduto(c.db, c.admin, { nome: "Máscara Própria", modalidade: "proprio", precoVendaCents: 6000 });
    await expect(registrarEntrada(c.db, c.admin, { produtoId: p.id, quantidade: 10 })).rejects.toThrow("custo unitário");
    await registrarEntrada(c.db, c.admin, { produtoId: p.id, quantidade: 10, custoUnitarioCents: 300 });
    await registrarEntrada(c.db, c.admin, { produtoId: p.id, quantidade: 10, custoUnitarioCents: 400 });
    expect(await prod(p.id)).toMatchObject({ quantidade: 20, custoMedioCents: 350 });
    await registrarEntrada(c.db, c.admin, { produtoId: p.id, quantidade: 5, custoUnitarioCents: 501 });
    // (20×350 + 5×501) / 25 = 380,2 → 380
    expect((await prod(p.id)).custoMedioCents).toBe(380);
  });

  it("consumo interno, perda e dano de próprio geram despesa a custo médio, sem repasse", async () => {
    const [p] = await c.db.select().from(produtos).where(eq(produtos.nome, "Máscara Própria"));
    const m1 = await registrarSaida(c.db, c.admin, { produtoId: p.id, tipo: "consumo_interno", quantidade: 2 });
    const m2 = await registrarSaida(c.db, c.admin, { produtoId: p.id, tipo: "perda", quantidade: 1 });
    const m3 = await registrarSaida(c.db, c.admin, { produtoId: p.id, tipo: "dano", quantidade: 1, justificativa: "Frasco quebrado" });
    expect([m1.custoTotalCents, m2.custoTotalCents, m3.custoTotalCents]).toEqual([760, 380, 380]);
    expect(m1.repasseTotalCents).toBe(0);
    expect(m1.quantidade).toBe(-2);
    expect((await prod(p.id)).quantidade).toBe(21);
    await expect(registrarSaida(c.db, c.admin, { produtoId: p.id, tipo: "consumo_interno", quantidade: 1.5 })).rejects.toThrow();
  });

  it("consignado: consumo/perda geram repasse; devolução ao fornecedor não", async () => {
    const p = await criarProduto(c.db, c.admin, { nome: "Óleo Consignado", modalidade: "consignado", fornecedorId: fornId, precoVendaCents: 5000, repasseCents: 3000 });
    await registrarEntrada(c.db, c.admin, { produtoId: p.id, quantidade: 6 });
    const cons = await registrarSaida(c.db, c.admin, { produtoId: p.id, tipo: "consumo_interno", quantidade: 1 });
    expect(cons).toMatchObject({ repasseUnitarioCents: 3000, repasseTotalCents: 3000, custoTotalCents: 0 });
    const dev = await registrarSaida(c.db, c.admin, { produtoId: p.id, tipo: "devolucao_fornecedor", quantidade: 2 });
    expect(dev.repasseTotalCents).toBe(0);
    expect((await prod(p.id)).quantidade).toBe(3);
  });

  it("divergência de inventário exige justificativa e classificação antes do repasse", async () => {
    const [p] = await c.db.select().from(produtos).where(eq(produtos.nome, "Óleo Consignado"));
    await expect(ajustarInventario(c.db, c.admin, { produtoId: p.id, quantidadeContada: 2, justificativa: "" })).rejects.toThrow();
    await expect(ajustarInventario(c.db, c.admin, { produtoId: p.id, quantidadeContada: 2, justificativa: "Contagem mensal" })).rejects.toThrow("Classifique");
    await expect(ajustarInventario(c.db, c.admin, { produtoId: p.id, quantidadeContada: 3, justificativa: "Contagem" })).rejects.toThrow("Não há divergência");
    const perda = await ajustarInventario(c.db, c.admin, { produtoId: p.id, quantidadeContada: 2, justificativa: "Contagem mensal", classificacao: "perda" });
    expect(perda).toMatchObject({ tipo: "ajuste_inventario", quantidade: -1, classificacao: "perda", repasseTotalCents: 3000 });
    const erro = await ajustarInventario(c.db, c.admin, { produtoId: p.id, quantidadeContada: 1, justificativa: "Lançado em dobro", classificacao: "erro_registro" });
    expect(erro.repasseTotalCents).toBe(0);
    const sobra = await ajustarInventario(c.db, c.admin, { produtoId: p.id, quantidadeContada: 4, justificativa: "Achado no depósito" });
    expect(sobra.quantidade).toBe(3);
    expect((await prod(p.id)).quantidade).toBe(4);
    const [log] = await listarAuditoria(c.db, c.admin, { entidade: "movimentacao" });
    expect(log.acao).toBe("ajuste_inventario");
  });

  it("estoque negativo: custo estimado e ajuste na regularização", async () => {
    const p = await criarProduto(c.db, c.admin, { nome: "Bala Própria", modalidade: "proprio", precoVendaCents: 100, custoCents: 50 });
    const s = await registrarSaida(c.db, c.admin, { produtoId: p.id, tipo: "consumo_interno", quantidade: 3 });
    expect(s.custoTotalCents).toBe(150);
    expect(await prod(p.id)).toMatchObject({ quantidade: -3, pendenteQtd: 3, pendenteCustoCents: 150 });
    const e = await registrarEntrada(c.db, c.admin, { produtoId: p.id, quantidade: 5, custoUnitarioCents: 60 });
    expect(e.ajusteCustoCents).toBe(30); // 3 × (60 − 50)
    expect(await prod(p.id)).toMatchObject({ quantidade: 2, pendenteQtd: 0, pendenteCustoCents: 0, custoMedioCents: 60 });
  });

  it("saldo inicial de implantação não duplica movimentações históricas", async () => {
    const p = await criarProduto(c.db, c.admin, { nome: "Perfume Próprio", modalidade: "proprio", precoVendaCents: 9000 });
    await registrarEntrada(c.db, c.admin, { produtoId: p.id, quantidade: 5, custoUnitarioCents: 4000, dataEfetiva: "2026-08-10" });
    expect((await prod(p.id)).quantidade).toBe(5);
    await definirSaldoInicial(c.db, c.admin, { produtoId: p.id, quantidade: 8, dataImplantacao: "2026-09-01", custoUnitarioCents: 4200 });
    expect(await prod(p.id)).toMatchObject({ quantidade: 8, custoMedioCents: 4200, dataImplantacao: "2026-09-01" });
    // retroativo anterior à implantação: entra no financeiro, não no saldo
    const hist = await registrarSaida(c.db, c.admin, { produtoId: p.id, tipo: "perda", quantidade: 1, dataEfetiva: "2026-08-20", custoUnitarioCents: 4000 });
    expect(hist).toMatchObject({ afetaEstoque: false, custoTotalCents: 4000 });
    expect((await prod(p.id)).quantidade).toBe(8);
    await registrarSaida(c.db, c.admin, { produtoId: p.id, tipo: "consumo_interno", quantidade: 1, dataEfetiva: "2026-09-15" });
    expect((await prod(p.id)).quantidade).toBe(7);
    await expect(definirSaldoInicial(c.db, c.admin, { produtoId: p.id, quantidade: 1, dataImplantacao: "2026-09-02" })).rejects.toThrow("já possui");
  });

  it("retroativo preserva valores praticados na época", async () => {
    const [p] = await c.db.select().from(produtos).where(eq(produtos.nome, "Óleo Consignado"));
    const m = await registrarSaida(c.db, c.admin, { produtoId: p.id, tipo: "dano", quantidade: 1, dataEfetiva: "2026-07-05", repasseUnitarioCents: 2500 });
    expect(m).toMatchObject({ dataEfetiva: "2026-07-05", repasseUnitarioCents: 2500, repasseTotalCents: 2500 });
    expect(m.registradoEm.getTime()).toBeGreaterThan(Date.parse("2026-10-01"));
  });

  it("correção anula a original, vincula a nova e mantém o saldo correto", async () => {
    const p = await criarProduto(c.db, c.admin, { nome: "Shampoo Próprio", modalidade: "proprio", precoVendaCents: 3000 });
    const e1 = await registrarEntrada(c.db, c.admin, { produtoId: p.id, quantidade: 10, custoUnitarioCents: 1000 });
    await registrarEntrada(c.db, c.admin, { produtoId: p.id, quantidade: 10, custoUnitarioCents: 2000 });
    expect((await prod(p.id)).custoMedioCents).toBe(1500);
    await expect(corrigirMovimentacao(c.db, c.admin, e1.id, { quantidade: 8, dataEfetiva: e1.dataEfetiva, justificativa: "" })).rejects.toThrow();
    const novo = await corrigirMovimentacao(c.db, c.admin, e1.id, { quantidade: 8, dataEfetiva: e1.dataEfetiva, custoUnitarioCents: 1000, justificativa: "Nota fiscal tinha 8 unidades" });
    const [orig] = await c.db.select().from(movimentacoes).where(eq(movimentacoes.id, e1.id));
    expect(orig).toMatchObject({ anulada: true, substituidaPor: novo.id });
    expect(novo.corrigeId).toBe(e1.id);
    // 10 @2000 restantes + 8 @1000 = 28000/18 = 1555,6 → 1556
    expect(await prod(p.id)).toMatchObject({ quantidade: 18, custoMedioCents: 1556 });
    await expect(anularMovimentacao(c.db, c.admin, e1.id, "de novo")).rejects.toThrow("já foi anulada");
    const lista = await listarMovimentacoes(c.db, c.admin, { produtoId: p.id });
    expect(lista.length).toBe(2);
    const comAnuladas = await listarMovimentacoes(c.db, c.admin, { produtoId: p.id, incluirAnuladas: true });
    expect(comAnuladas.length).toBe(3);
  });

  it("regras de acesso e de data", async () => {
    const [p] = await c.db.select().from(produtos).where(eq(produtos.nome, "Shampoo Próprio"));
    await expect(registrarEntrada(c.db, c.colab, { produtoId: p.id, quantidade: 1, custoUnitarioCents: 1 })).rejects.toThrow("permissão");
    await expect(registrarSaida(c.db, c.colab, { produtoId: p.id, tipo: "perda", quantidade: 1 })).rejects.toThrow("permissão");
    await expect(listarMovimentacoes(c.db, c.colab)).rejects.toThrow("permissão");
    await expect(registrarSaida(c.db, c.admin, { produtoId: p.id, tipo: "perda", quantidade: 1, dataEfetiva: "2099-01-01" })).rejects.toThrow("futuro");
  });

  it("histórico é protegido pelo banco e o saldo bate com as movimentações", async () => {
    await expect(c.db.execute(sql`delete from movimentacoes`)).rejects.toThrow();
    await expect(c.db.execute(sql`update movimentacoes set quantidade = 99`)).rejects.toThrow();
    await expect(c.db.execute(sql`update movimentacoes set anulada = false where anulada = true`)).rejects.toThrow();
    expect(await verificarConsistencia(c.db)).toEqual([]);
  });
});
