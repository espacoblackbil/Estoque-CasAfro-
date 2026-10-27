import { and, asc, eq, ilike, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db";
import { categorias, fornecedores, movimentacoes, produtos } from "../db/schema";
import { ErroNegocio } from "../erros";
import { auditar } from "./auditoria";
import { obterConfiguracoes } from "./configuracoes";
import { ehAdmin, exigirAdmin, type Ator } from "./permissoes";

// ───────────────────────────── Categorias ─────────────────────────────

const esquemaCategoria = z.object({
  nome: z.string().trim().min(1, "Informe o nome da categoria").max(80),
  ordem: z.number().int().default(0),
  ativo: z.boolean().default(true),
});

export async function salvarCategoria(db: DB, ator: Ator, dados: z.input<typeof esquemaCategoria>, id?: number) {
  exigirAdmin(ator);
  const v = esquemaCategoria.parse(dados);
  return db.transaction(async (tx) => {
    const [dup] = await tx
      .select({ id: categorias.id })
      .from(categorias)
      .where(and(sql`lower(${categorias.nome}) = lower(${v.nome})`, id ? sql`${categorias.id} <> ${id}` : undefined));
    if (dup) throw new ErroNegocio("Já existe uma categoria com este nome.");
    if (id) {
      const [antes] = await tx.select().from(categorias).where(eq(categorias.id, id));
      if (!antes) throw new ErroNegocio("Categoria não encontrada.");
      await tx.update(categorias).set(v).where(eq(categorias.id, id));
      await auditar(tx, ator, { acao: "editar_categoria", entidade: "categoria", entidadeId: id, antes, depois: v });
      return { id, ...v };
    }
    const [c] = await tx.insert(categorias).values(v).returning();
    await auditar(tx, ator, { acao: "criar_categoria", entidade: "categoria", entidadeId: c.id, depois: c });
    return c;
  });
}

export async function listarCategorias(db: DB) {
  return db.select().from(categorias).orderBy(asc(categorias.ordem), asc(categorias.nome));
}

// ───────────────────────────── Fornecedores ─────────────────────────────

/** Valida CPF/CNPJ pelos dígitos verificadores (aceita vazio). */
export function documentoValido(doc: string): boolean {
  const d = doc.replace(/\D/g, "");
  if (d === "") return true;
  if (/^(\d)\1+$/.test(d)) return false;
  const calc = (base: string, pesos: number[]) => {
    const s = base.split("").reduce((acc, n, i) => acc + Number(n) * pesos[i], 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  if (d.length === 11) {
    const p1 = [10, 9, 8, 7, 6, 5, 4, 3, 2];
    const p2 = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
    return calc(d.slice(0, 9), p1) === Number(d[9]) && calc(d.slice(0, 10), p2) === Number(d[10]);
  }
  if (d.length === 14) {
    const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const p2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    return calc(d.slice(0, 12), p1) === Number(d[12]) && calc(d.slice(0, 13), p2) === Number(d[13]);
  }
  return false;
}

const esquemaFornecedor = z.object({
  nome: z.string().trim().min(2, "Informe o nome do fornecedor").max(150),
  documento: z.string().trim().max(20).default("").refine(documentoValido, "CPF ou CNPJ inválido"),
  telefone: z.string().trim().max(40).default(""),
  ativo: z.boolean().default(true),
});

export async function salvarFornecedor(db: DB, ator: Ator, dados: z.input<typeof esquemaFornecedor>, id?: number) {
  exigirAdmin(ator);
  const v = esquemaFornecedor.parse(dados);
  return db.transaction(async (tx) => {
    if (id) {
      const [antes] = await tx.select().from(fornecedores).where(eq(fornecedores.id, id));
      if (!antes) throw new ErroNegocio("Fornecedor não encontrado.");
      await tx.update(fornecedores).set(v).where(eq(fornecedores.id, id));
      await auditar(tx, ator, { acao: "editar_fornecedor", entidade: "fornecedor", entidadeId: id, antes, depois: v });
      return { id, ...v };
    }
    const [f] = await tx.insert(fornecedores).values(v).returning();
    await auditar(tx, ator, { acao: "criar_fornecedor", entidade: "fornecedor", entidadeId: f.id, depois: f });
    return f;
  });
}

export async function listarFornecedores(db: DB, ator: Ator) {
  exigirAdmin(ator);
  return db.select().from(fornecedores).orderBy(asc(fornecedores.nome));
}

// ───────────────────────────── Produtos ─────────────────────────────

const esquemaProduto = z
  .object({
    nome: z.string().trim().min(2, "Informe o nome do produto").max(150),
    categoriaId: z.number().int().positive().nullable().default(null),
    fornecedorId: z.number().int().positive().nullable().default(null),
    modalidade: z.enum(["proprio", "consignado"]),
    precoVendaCents: z.number().int().min(0, "Preço inválido"),
    /** Próprio: custo de referência inicial (depois mantido pelo custo médio das entradas). */
    custoCents: z.number().int().min(0).default(0),
    repasseCents: z.number().int().min(0).default(0),
    comissaoBps: z.number().int().min(0).max(10000).default(0),
    ativo: z.boolean().default(true),
  })
  .superRefine((p, ctx) => {
    if (p.modalidade === "consignado") {
      if (!p.fornecedorId) ctx.addIssue({ code: "custom", message: "Produto consignado exige fornecedor", path: ["fornecedorId"] });
      if (p.repasseCents <= 0) ctx.addIssue({ code: "custom", message: "Informe o valor de repasse do consignado", path: ["repasseCents"] });
    }
  });

export type DadosProduto = z.input<typeof esquemaProduto>;

export async function criarProduto(db: DB, ator: Ator, dados: DadosProduto) {
  exigirAdmin(ator);
  const v = esquemaProduto.parse(dados);
  return db.transaction(async (tx) => {
    const [p] = await tx
      .insert(produtos)
      .values({
        nome: v.nome,
        categoriaId: v.categoriaId,
        fornecedorId: v.fornecedorId,
        modalidade: v.modalidade,
        precoVendaCents: v.precoVendaCents,
        custoMedioCents: v.modalidade === "proprio" ? v.custoCents : 0,
        repasseCents: v.modalidade === "consignado" ? v.repasseCents : 0,
        comissaoBps: v.comissaoBps,
        ativo: v.ativo,
      })
      .returning();
    await auditar(tx, ator, { acao: "criar_produto", entidade: "produto", entidadeId: p.id, depois: p });
    return p;
  });
}

/**
 * Edita cadastro. Alterações de preço, repasse e comissão valem só para movimentações futuras:
 * os valores históricos ficam congelados em cada venda/movimentação (spec §9).
 */
export async function editarProduto(db: DB, ator: Ator, id: number, dados: DadosProduto, justificativa?: string) {
  exigirAdmin(ator);
  const v = esquemaProduto.parse(dados);
  return db.transaction(async (tx) => {
    const [antes] = await tx.select().from(produtos).where(eq(produtos.id, id)).for("update");
    if (!antes) throw new ErroNegocio("Produto não encontrado.");
    if (v.modalidade !== antes.modalidade) {
      const [mov] = await tx.select({ id: movimentacoes.id }).from(movimentacoes).where(eq(movimentacoes.produtoId, id)).limit(1);
      if (mov) throw new ErroNegocio("A modalidade não pode mudar depois de haver movimentações. Cadastre um novo produto.");
    }
    const custoMudou = v.modalidade === "proprio" && v.custoCents !== antes.custoMedioCents;
    if (custoMudou && !justificativa?.trim()) {
      throw new ErroNegocio("Alterar manualmente o custo médio exige justificativa.");
    }
    const novo = {
      nome: v.nome,
      categoriaId: v.categoriaId,
      fornecedorId: v.fornecedorId,
      modalidade: v.modalidade,
      precoVendaCents: v.precoVendaCents,
      custoMedioCents: v.modalidade === "proprio" ? v.custoCents : 0,
      repasseCents: v.modalidade === "consignado" ? v.repasseCents : 0,
      comissaoBps: v.comissaoBps,
      ativo: v.ativo,
    };
    await tx.update(produtos).set(novo).where(eq(produtos.id, id));
    await auditar(tx, ator, { acao: "editar_produto", entidade: "produto", entidadeId: id, antes, depois: novo, justificativa });
    return { ...antes, ...novo };
  });
}

/** Visão para colaboradores: sem custo, repasse, comissão ou fornecedor (spec §3.3). */
export interface ProdutoPublico {
  id: number;
  nome: string;
  categoria: string | null;
  precoVendaCents: number;
  quantidade: number;
  estoqueBaixo: boolean;
  ativo: boolean;
}

export async function listarProdutosPublico(db: DB, _ator: Ator, busca?: string, incluirInativos = false): Promise<ProdutoPublico[]> {
  const cfg = await obterConfiguracoes(db);
  const conds: SQL[] = [];
  if (busca?.trim()) conds.push(ilike(produtos.nome, `%${busca.trim()}%`));
  if (!incluirInativos) conds.push(eq(produtos.ativo, true));
  const linhas = await db
    .select({
      id: produtos.id,
      nome: produtos.nome,
      categoria: categorias.nome,
      precoVendaCents: produtos.precoVendaCents,
      quantidade: produtos.quantidade,
      ativo: produtos.ativo,
    })
    .from(produtos)
    .leftJoin(categorias, eq(categorias.id, produtos.categoriaId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(produtos.nome));
  return linhas.map((l) => ({ ...l, estoqueBaixo: l.quantidade <= cfg.estoqueMinimo }));
}

/** Visão administrativa completa. */
export async function listarProdutosAdmin(db: DB, ator: Ator, filtro: { busca?: string; incluirInativos?: boolean } = {}) {
  exigirAdmin(ator);
  const cfg = await obterConfiguracoes(db);
  const conds: SQL[] = [];
  if (filtro.busca?.trim()) conds.push(ilike(produtos.nome, `%${filtro.busca.trim()}%`));
  if (!filtro.incluirInativos) conds.push(eq(produtos.ativo, true));
  const linhas = await db
    .select({
      produto: produtos,
      categoria: categorias.nome,
      fornecedor: fornecedores.nome,
    })
    .from(produtos)
    .leftJoin(categorias, eq(categorias.id, produtos.categoriaId))
    .leftJoin(fornecedores, eq(fornecedores.id, produtos.fornecedorId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(produtos.nome));
  return linhas.map((l) => ({
    ...l.produto,
    categoria: l.categoria,
    fornecedor: l.fornecedor,
    estoqueBaixo: l.produto.quantidade <= cfg.estoqueMinimo,
  }));
}

export async function obterProdutoAdmin(db: DB, ator: Ator, id: number) {
  exigirAdmin(ator);
  const [p] = await db.select().from(produtos).where(eq(produtos.id, id));
  if (!p) throw new ErroNegocio("Produto não encontrado.");
  return p;
}

export async function listarProdutos(db: DB, ator: Ator, busca?: string) {
  return ehAdmin(ator) ? listarProdutosAdmin(db, ator, { busca }) : listarProdutosPublico(db, ator, busca);
}
