import { describe, it, expect, beforeAll } from "vitest";
import { novoCenario, type Cenario } from "./helpers";
import {
  criarProduto, documentoValido, editarProduto, listarCategorias, listarFornecedores, listarProdutos,
  listarProdutosPublico, salvarCategoria, salvarFornecedor,
} from "@/server/services/cadastros";
import { listarAuditoria } from "@/server/services/auditoria";

describe("M2 · cadastros", () => {
  let c: Cenario;
  beforeAll(async () => { c = await novoCenario(); });

  it("valida CPF/CNPJ", () => {
    expect(documentoValido("41.915.055/0001-09")).toBe(true);
    expect(documentoValido("41.915.055/0001-08")).toBe(false);
    expect(documentoValido("529.982.247-25")).toBe(true);
    expect(documentoValido("111.111.111-11")).toBe(false);
    expect(documentoValido("")).toBe(true);
  });

  it("categorias livres e únicas; só admin cadastra", async () => {
    await salvarCategoria(c.db, c.admin, { nome: "Cabelo" });
    await salvarCategoria(c.db, c.admin, { nome: "Bebidas", ordem: 2 });
    await expect(salvarCategoria(c.db, c.admin, { nome: "cabelo" })).rejects.toThrow("Já existe");
    await expect(salvarCategoria(c.db, c.colab, { nome: "Doces" })).rejects.toThrow();
    expect((await listarCategorias(c.db)).map((x) => x.nome)).toEqual(["Cabelo", "Bebidas"]);
  });

  it("fornecedor exige documento válido; colaborador não lista", async () => {
    await expect(salvarFornecedor(c.db, c.admin, { nome: "Forn X", documento: "123" })).rejects.toThrow();
    const f = await salvarFornecedor(c.db, c.admin, { nome: "Óleos da Terra", documento: "529.982.247-25", telefone: "(71) 99999-0000" });
    expect(f.id).toBeGreaterThan(0);
    await expect(listarFornecedores(c.db, c.colab)).rejects.toThrow();
  });

  it("produto consignado exige fornecedor e repasse; modalidade única", async () => {
    await expect(
      criarProduto(c.db, c.admin, { nome: "Óleo", modalidade: "consignado", precoVendaCents: 5000, repasseCents: 0 }),
    ).rejects.toThrow();
    const [f] = await listarFornecedores(c.db, c.admin);
    const p = await criarProduto(c.db, c.admin, {
      nome: "Óleo de Rícino", modalidade: "consignado", fornecedorId: f.id, precoVendaCents: 5000, repasseCents: 3000, comissaoBps: 1000,
    });
    expect(p.repasseCents).toBe(3000);
    expect(p.custoMedioCents).toBe(0);
    const proprio = await criarProduto(c.db, c.admin, { nome: "Refrigerante Lata", modalidade: "proprio", precoVendaCents: 600, custoCents: 280 });
    expect(proprio.custoMedioCents).toBe(280);
    expect(proprio.comissaoBps).toBe(0); // sem percentual = comissão zero
  });

  it("alteração manual de custo exige justificativa e fica auditada", async () => {
    const [p] = (await listarProdutos(c.db, c.admin, "Refrigerante")) as { id: number }[];
    const base = { nome: "Refrigerante Lata", modalidade: "proprio" as const, precoVendaCents: 700, custoCents: 300 };
    await expect(editarProduto(c.db, c.admin, p.id, base)).rejects.toThrow("justificativa");
    await editarProduto(c.db, c.admin, p.id, base, "Novo custo informado pelo distribuidor");
    const [log] = await listarAuditoria(c.db, c.admin, { entidade: "produto" });
    expect(log.antes).toMatchObject({ precoVendaCents: 600, custoMedioCents: 280 });
    expect(log.depois).toMatchObject({ precoVendaCents: 700, custoMedioCents: 300 });
    expect(log.justificativa).toContain("distribuidor");
  });

  it("colaborador vê preço e disponibilidade, nunca custo/repasse/comissão/fornecedor", async () => {
    const lista = await listarProdutos(c.db, c.colab);
    expect(lista.length).toBe(2);
    for (const p of lista) {
      const chaves = Object.keys(p);
      expect(chaves.sort()).toEqual(["ativo", "categoria", "estoqueBaixo", "id", "nome", "precoVendaCents", "quantidade"]);
    }
    const busca = await listarProdutosPublico(c.db, c.colab, "rícino");
    expect(busca.map((p) => p.nome)).toEqual(["Óleo de Rícino"]);
  });
});
