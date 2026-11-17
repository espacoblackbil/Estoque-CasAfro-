/**
 * Vendas, cancelamentos e devoluções (spec §7, §8, §9, §13).
 *
 *  - Uma venda = vários itens, um colaborador responsável, pagamentos divididos que fecham no total.
 *  - Descontos (por item e no total) só por administradores. O desconto total é rateado
 *    proporcionalmente (maiores restos) — a soma dos itens fecha exatamente no total da venda.
 *  - Comissão por item = líquido do item × % do produto (congelado no item).
 *  - Margem negativa (líquido < custo/repasse) exige autorização de administrador.
 *  - Idempotência: a mesma `chaveIdempotencia` nunca gera duas vendas.
 *  - Tudo em uma única transação: ou a venda inteira é gravada, ou nada.
 */
import { and, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db";
import {
  comissaoLancamentos, produtos, usuarios, vendaDevolucoes, vendaItens, vendaPagamentos, vendas,
} from "../db/schema";
import { ErroNegocio, ErroPermissao } from "../erros";
import { aplicarBps, arred, ratear } from "@/domain/money";
import { hoje, validarData } from "@/domain/datas";
import { auditar } from "./auditoria";
import { afetaEstoque, lancarEntrada, lancarSaida, travarProduto, type Produto } from "./estoque";
import { estornarComissao } from "./comissoes";
import { autorizacaoAdmin } from "./usuarios";
import { ehAdmin, exigirAdmin, type Ator } from "./permissoes";

const esquemaItem = z.object({
  produtoId: z.number().int().positive(),
  quantidade: z.number().int().positive("Quantidade deve ser inteira e positiva"),
  descontoCents: z.number().int().min(0).default(0),
  /** Retroativos (somente admin): valores praticados na época. */
  precoUnitarioCents: z.number().int().min(0).optional(),
  custoUnitarioCents: z.number().int().min(0).optional(),
  repasseUnitarioCents: z.number().int().min(0).optional(),
  comissaoBps: z.number().int().min(0).max(10000).optional(),
});

const esquemaVenda = z.object({
  chaveIdempotencia: z.string().min(8).max(100),
  colaboradorId: z.number().int().positive(),
  cliente: z.string().trim().max(120).optional(),
  dataEfetiva: z.string().optional(),
  itens: z.array(esquemaItem).min(1, "Adicione ao menos um produto").max(100),
  descontoTotalCents: z.number().int().min(0).default(0),
  pagamentos: z
    .array(z.object({ forma: z.enum(["pix", "dinheiro", "debito", "credito"]), valorCents: z.number().int().positive() }))
    .max(10),
  /** Admin confirmando conscientemente a margem negativa. */
  autorizarMargemNegativa: z.boolean().optional(),
  /** Colaborador: credenciais de um administrador que autoriza a margem negativa. */
  autorizacao: z.object({ login: z.string(), senha: z.string() }).optional(),
});

export type EntradaVenda = z.input<typeof esquemaVenda>;

export class ErroMargemNegativa extends ErroNegocio {
  constructor(public itens: { produtoId: number; nome: string }[]) {
    super("Venda com margem negativa: é necessária a autorização de um administrador.", "margem_negativa");
  }
}

interface ItemCalculado {
  p: Produto;
  qtd: number;
  precoUnit: number;
  bruto: number;
  descontoItem: number;
  descontoRateado: number;
  liquido: number;
  custoUnit: number;
  repasseUnit: number;
  comissaoBps: number;
  comissao: number;
  qtdSemSaldo: number;
}

/** Cálculo puro dos valores da venda (exportado para pré-visualização na tela). */
export function calcularItens(
  entrada: { p: Produto; qtd: number; descontoCents: number; precoUnitarioCents?: number; custoUnitarioCents?: number; repasseUnitarioCents?: number; comissaoBps?: number }[],
  descontoTotalCents: number,
) {
  const parcial = entrada.map((e) => {
    const precoUnit = e.precoUnitarioCents ?? e.p.precoVendaCents;
    const bruto = precoUnit * e.qtd;
    if (e.descontoCents > bruto) throw new ErroNegocio(`Desconto maior que o valor do item "${e.p.nome}".`);
    return { ...e, precoUnit, bruto, base: bruto - e.descontoCents };
  });
  const somaBase = parcial.reduce((a, i) => a + i.base, 0);
  if (descontoTotalCents > somaBase) throw new ErroNegocio("Desconto maior que o valor da venda.");
  const rateio = ratear(descontoTotalCents, parcial.map((i) => i.base));
  const itens: ItemCalculado[] = parcial.map((i, k) => {
    const liquido = i.base - rateio[k];
    const comissaoBps = i.comissaoBps ?? i.p.comissaoBps;
    const custoUnit = i.p.modalidade === "proprio" ? (i.custoUnitarioCents ?? i.p.custoMedioCents) : 0;
    const repasseUnit = i.p.modalidade === "consignado" ? (i.repasseUnitarioCents ?? i.p.repasseCents) : 0;
    return {
      p: i.p,
      qtd: i.qtd,
      precoUnit: i.precoUnit,
      bruto: i.bruto,
      descontoItem: i.descontoCents,
      descontoRateado: rateio[k],
      liquido,
      custoUnit,
      repasseUnit,
      comissaoBps,
      comissao: aplicarBps(liquido, comissaoBps),
      qtdSemSaldo: 0,
    };
  });
  return itens;
}

export const margemItem = (i: { liquido: number; custoUnit: number; repasseUnit: number; qtd: number }) =>
  i.liquido - (i.custoUnit + i.repasseUnit) * i.qtd;

async function buscarPorChave(db: DB, chave: string) {
  const [v] = await db.select().from(vendas).where(eq(vendas.chaveIdempotencia, chave));
  return v;
}

export async function registrarVenda(db: DB, ator: Ator, dados: EntradaVenda) {
  const v = esquemaVenda.parse(dados);
  const admin = ehAdmin(ator);

  // Idempotência: repetição da mesma operação devolve a venda já gravada.
  const existente = await buscarPorChave(db, v.chaveIdempotencia);
  if (existente) return { venda: existente, duplicada: true };

  if (!admin) {
    if (v.colaboradorId !== ator.id) throw new ErroPermissao("Colaboradores registram vendas apenas em seu próprio nome.");
    if (v.descontoTotalCents > 0 || v.itens.some((i) => i.descontoCents > 0)) {
      throw new ErroPermissao("Somente administradores podem aplicar descontos.");
    }
    if (v.dataEfetiva && v.dataEfetiva !== hoje()) throw new ErroPermissao("Somente administradores lançam vendas retroativas.");
    if (v.itens.some((i) => i.precoUnitarioCents !== undefined || i.custoUnitarioCents !== undefined || i.repasseUnitarioCents !== undefined || i.comissaoBps !== undefined)) {
      throw new ErroPermissao("Somente administradores informam valores históricos.");
    }
  }
  const data = v.dataEfetiva ? validarData(v.dataEfetiva) : hoje();
  if (data > hoje()) throw new ErroNegocio("A data da venda não pode estar no futuro.");
  const ids = v.itens.map((i) => i.produtoId);
  if (new Set(ids).size !== ids.length) throw new ErroNegocio("O mesmo produto aparece mais de uma vez; ajuste a quantidade.");

  // Autorização de colaborador por credenciais de admin é verificada fora da transação (bcrypt é lento).
  const autorizadorExterno = v.autorizacao ? await autorizacaoAdmin(db, v.autorizacao.login, v.autorizacao.senha) : null;

  try {
    return await db.transaction(async (tx) => {
      const [resp] = await tx.select().from(usuarios).where(eq(usuarios.id, v.colaboradorId));
      if (!resp || !resp.ativo) throw new ErroNegocio("Colaborador responsável inválido ou inativo.");

      // Trava produtos em ordem de id (evita deadlock entre vendas simultâneas).
      const travados = new Map<number, Produto>();
      for (const id of [...ids].sort((a, b) => a - b)) travados.set(id, await travarProduto(tx, id));
      for (const p of travados.values()) if (!p.ativo) throw new ErroNegocio(`O produto "${p.nome}" está inativo.`);

      const itens = calcularItens(
        v.itens.map((i) => ({ ...i, p: travados.get(i.produtoId)!, qtd: i.quantidade })),
        v.descontoTotalCents,
      );
      for (const i of itens) {
        if (afetaEstoque(i.p, data)) i.qtdSemSaldo = i.qtd - Math.min(i.qtd, Math.max(i.p.quantidade, 0));
      }

      const bruto = itens.reduce((a, i) => a + i.bruto, 0);
      const descItens = itens.reduce((a, i) => a + i.descontoItem, 0);
      const liquido = itens.reduce((a, i) => a + i.liquido, 0);
      const somaPag = v.pagamentos.reduce((a, p) => a + p.valorCents, 0);
      if (somaPag !== liquido) {
        throw new ErroNegocio(`A soma dos pagamentos (${(somaPag / 100).toFixed(2)}) deve ser igual ao total da venda (${(liquido / 100).toFixed(2)}).`);
      }

      // Margem negativa → autorização obrigatória.
      const negativos = itens.filter((i) => margemItem(i) < 0);
      let autorizadoPor: number | null = null;
      if (negativos.length) {
        if (autorizadorExterno) autorizadoPor = autorizadorExterno.id;
        else if (admin && v.autorizarMargemNegativa) autorizadoPor = ator.id;
        else throw new ErroMargemNegativa(negativos.map((i) => ({ produtoId: i.p.id, nome: i.p.nome })));
      }

      const estoqueNegativo = itens.some((i) => afetaEstoque(i.p, data) && i.p.quantidade - i.qtd < 0);
      const [venda] = await tx
        .insert(vendas)
        .values({
          chaveIdempotencia: v.chaveIdempotencia,
          dataEfetiva: data,
          colaboradorId: v.colaboradorId,
          registradoPor: ator.id,
          cliente: v.cliente || null,
          brutoCents: bruto,
          descontoItensCents: descItens,
          descontoTotalCents: v.descontoTotalCents,
          liquidoCents: liquido,
          margemNegativa: negativos.length > 0,
          autorizadoPor,
          estoqueNegativo,
        })
        .returning();

      for (const i of itens) {
        const [item] = await tx
          .insert(vendaItens)
          .values({
            vendaId: venda.id,
            produtoId: i.p.id,
            modalidade: i.p.modalidade,
            fornecedorId: i.p.fornecedorId,
            quantidade: i.qtd,
            precoUnitarioCents: i.precoUnit,
            brutoCents: i.bruto,
            descontoItemCents: i.descontoItem,
            descontoRateadoCents: i.descontoRateado,
            liquidoCents: i.liquido,
            custoUnitarioCents: i.custoUnit,
            custoTotalCents: i.custoUnit * i.qtd,
            repasseUnitarioCents: i.repasseUnit,
            repasseTotalCents: i.repasseUnit * i.qtd,
            comissaoBps: i.comissaoBps,
            comissaoCents: i.comissao,
            qtdSemSaldo: i.qtdSemSaldo,
          })
          .returning();
        await lancarSaida(tx, ator, i.p, {
          tipo: "venda",
          qtd: i.qtd,
          data,
          efeito: "venda",
          custoUnitarioCents: i.custoUnit,
          repasseUnitarioCents: i.repasseUnit,
          vendaItemId: item.id,
        });
        if (i.comissao > 0) {
          await tx.insert(comissaoLancamentos).values({
            colaboradorId: v.colaboradorId,
            tipo: "gerada",
            valorCents: i.comissao,
            dataEfetiva: data,
            vendaId: venda.id,
            vendaItemId: item.id,
            descricao: `Venda #${venda.id} — ${i.qtd}× ${i.p.nome}`,
            registradoPor: ator.id,
          });
        }
      }
      if (v.pagamentos.length) {
        await tx.insert(vendaPagamentos).values(v.pagamentos.map((p) => ({ vendaId: venda.id, forma: p.forma, valorCents: p.valorCents })));
      }
      if (data !== hoje() || negativos.length || v.descontoTotalCents || descItens) {
        await auditar(tx, ator, {
          acao: "venda",
          entidade: "venda",
          entidadeId: venda.id,
          depois: { liquidoCents: liquido, descontos: descItens + v.descontoTotalCents, retroativa: data !== hoje(), margemNegativa: negativos.length > 0, autorizadoPor },
          dataEfetiva: data,
        });
      }
      return { venda, duplicada: false };
    });
  } catch (e) {
    // Corrida entre duas requisições com a mesma chave: a segunda devolve a primeira.
    const dup = await buscarPorChave(db, v.chaveIdempotencia);
    if (dup) return { venda: dup, duplicada: true };
    throw e;
  }
}

// ───────────────────────────── Cancelamento / devolução ─────────────────────────────

const esquemaDevolucao = z.object({
  /** Sem itens = cancelamento total (tudo o que ainda não foi devolvido). */
  itens: z.array(z.object({ vendaItemId: z.number().int().positive(), quantidade: z.number().int().positive() })).optional(),
  dataEfetiva: z.string().optional(),
  justificativa: z.string().trim().min(3, "Justificativa obrigatória").max(500),
});

/** Parcela proporcional acumulada: valor das primeiras `k` de `q` unidades. */
const parcela = (total: number, k: number, q: number) => arred(total * k, q);

export async function devolverVenda(db: DB, ator: Ator, vendaId: number, dados: z.input<typeof esquemaDevolucao>) {
  exigirAdmin(ator);
  const v = esquemaDevolucao.parse(dados);
  const data = v.dataEfetiva ? validarData(v.dataEfetiva) : hoje();
  if (data > hoje()) throw new ErroNegocio("A data não pode estar no futuro.");
  return db.transaction(async (tx) => {
    const [venda] = await tx.select().from(vendas).where(eq(vendas.id, vendaId)).for("update");
    if (!venda) throw new ErroNegocio("Venda não encontrada.");
    if (venda.situacao === "cancelada") throw new ErroNegocio("Esta venda já foi cancelada.");
    if (data < venda.dataEfetiva) throw new ErroNegocio("A devolução não pode ser anterior à venda.");
    const itens = await tx.select().from(vendaItens).where(eq(vendaItens.vendaId, vendaId)).orderBy(vendaItens.id);
    const pedidos = v.itens ?? itens.filter((i) => i.quantidade > i.qtdDevolvida).map((i) => ({ vendaItemId: i.id, quantidade: i.quantidade - i.qtdDevolvida }));
    if (!pedidos.length) throw new ErroNegocio("Nada a devolver nesta venda.");

    const devolucoes = [];
    for (const ped of pedidos) {
      const it = itens.find((i) => i.id === ped.vendaItemId);
      if (!it) throw new ErroNegocio("Item não pertence a esta venda.");
      const restante = it.quantidade - it.qtdDevolvida;
      if (ped.quantidade > restante) throw new ErroNegocio(`Quantidade a devolver maior que a vendida (restam ${restante}).`);
      const d0 = it.qtdDevolvida;
      const d1 = d0 + ped.quantidade;
      const q = it.quantidade;
      const fatia = (total: number) => parcela(total, d1, q) - parcela(total, d0, q);
      const valores = {
        bruto: fatia(it.brutoCents),
        desconto: fatia(it.descontoItemCents + it.descontoRateadoCents),
        liquido: fatia(it.liquidoCents),
        custo: fatia(it.custoTotalCents),
        repasse: fatia(it.repasseTotalCents),
        comissao: fatia(it.comissaoCents),
      };
      const [dev] = await tx
        .insert(vendaDevolucoes)
        .values({
          vendaId,
          vendaItemId: it.id,
          quantidade: ped.quantidade,
          dataEfetiva: data,
          brutoCents: valores.bruto,
          descontoCents: valores.desconto,
          liquidoCents: valores.liquido,
          custoCents: valores.custo,
          repasseCents: valores.repasse,
          comissaoCents: valores.comissao,
          justificativa: v.justificativa,
          usuarioId: ator.id,
        })
        .returning();
      await tx.update(vendaItens).set({ qtdDevolvida: d1 }).where(eq(vendaItens.id, it.id));
      it.qtdDevolvida = d1;

      // Mercadoria volta ao estoque com o custo/repasse congelados da venda; repasse devido é estornado.
      const p = await travarProduto(tx, it.produtoId);
      await lancarEntrada(tx, ator, p, {
        tipo: "devolucao_venda",
        qtd: ped.quantidade,
        data,
        custoUnitarioCents: it.custoUnitarioCents,
        justificativa: v.justificativa,
        atualizaCustoMedio: p.modalidade === "proprio",
        vendaItemId: it.id,
        repasseUnitarioCents: it.repasseUnitarioCents,
        repasseTotalCents: -valores.repasse,
      });
      await estornarComissao(tx, ator, {
        colaboradorId: venda.colaboradorId,
        valorCents: valores.comissao,
        dataEfetiva: data,
        vendaId,
        vendaItemId: it.id,
        descricao: `Venda #${vendaId} — devolução de ${ped.quantidade}× ${p.nome}`,
      });
      devolucoes.push(dev);
    }
    const tudo = itens.every((i) => i.qtdDevolvida === i.quantidade);
    const situacao = tudo ? "cancelada" : "devolvida_parcial";
    await tx.update(vendas).set({ situacao }).where(eq(vendas.id, vendaId));
    await auditar(tx, ator, {
      acao: tudo ? "cancelar_venda" : "devolucao_parcial",
      entidade: "venda",
      entidadeId: vendaId,
      antes: { situacao: venda.situacao },
      depois: { situacao, devolucoes },
      justificativa: v.justificativa,
      dataEfetiva: data,
    });
    return { situacao, devolucoes };
  });
}

export const cancelarVenda = (db: DB, ator: Ator, vendaId: number, justificativa: string, dataEfetiva?: string) =>
  devolverVenda(db, ator, vendaId, { justificativa, dataEfetiva });

// ───────────────────────────── Consultas ─────────────────────────────

/** Lista vendas. Colaborador vê apenas as suas (responsável ou registrante), sem custos. */
export async function listarVendas(db: DB, ator: Ator, filtro: { de?: string; ate?: string; colaboradorId?: number; limite?: number } = {}) {
  const conds: SQL[] = [];
  if (filtro.de) conds.push(gte(vendas.dataEfetiva, filtro.de));
  if (filtro.ate) conds.push(lte(vendas.dataEfetiva, filtro.ate));
  if (!ehAdmin(ator)) conds.push(eq(vendas.colaboradorId, ator.id));
  else if (filtro.colaboradorId) conds.push(eq(vendas.colaboradorId, filtro.colaboradorId));
  return db
    .select({
      id: vendas.id,
      dataEfetiva: vendas.dataEfetiva,
      cliente: vendas.cliente,
      colaborador: usuarios.nome,
      colaboradorId: vendas.colaboradorId,
      brutoCents: vendas.brutoCents,
      descontoCents: sql<number>`(${vendas.descontoItensCents} + ${vendas.descontoTotalCents})::int`,
      liquidoCents: vendas.liquidoCents,
      situacao: vendas.situacao,
      estoqueNegativo: vendas.estoqueNegativo,
      criadoEm: vendas.criadoEm,
    })
    .from(vendas)
    .innerJoin(usuarios, eq(usuarios.id, vendas.colaboradorId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(vendas.dataEfetiva), desc(vendas.id))
    .limit(filtro.limite ?? 200);
}

export async function obterVenda(db: DB, ator: Ator, id: number) {
  const [venda] = await db.select().from(vendas).where(eq(vendas.id, id));
  if (!venda) throw new ErroNegocio("Venda não encontrada.");
  const admin = ehAdmin(ator);
  if (!admin && venda.colaboradorId !== ator.id) throw new ErroPermissao();
  const itens = await db
    .select({ item: vendaItens, nome: produtos.nome })
    .from(vendaItens)
    .innerJoin(produtos, eq(produtos.id, vendaItens.produtoId))
    .where(eq(vendaItens.vendaId, id))
    .orderBy(vendaItens.id);
  const pagamentos = await db.select().from(vendaPagamentos).where(eq(vendaPagamentos.vendaId, id));
  const devolucoes = await db.select().from(vendaDevolucoes).where(eq(vendaDevolucoes.vendaId, id));
  const pessoas = await db
    .select({ id: usuarios.id, nome: usuarios.nome })
    .from(usuarios)
    .where(inArray(usuarios.id, [venda.colaboradorId, venda.registradoPor, venda.autorizadoPor ?? venda.colaboradorId]));
  const nome = (uid: number | null) => pessoas.find((p) => p.id === uid)?.nome ?? null;

  const itensVisao = itens.map(({ item, nome: produto }) => {
    const publico = {
      id: item.id,
      produto,
      quantidade: item.quantidade,
      qtdDevolvida: item.qtdDevolvida,
      precoUnitarioCents: item.precoUnitarioCents,
      brutoCents: item.brutoCents,
      descontoCents: item.descontoItemCents + item.descontoRateadoCents,
      liquidoCents: item.liquidoCents,
      comissaoCents: item.comissaoCents, // a própria comissão é visível ao colaborador
    };
    if (!admin) return publico;
    return {
      ...publico,
      modalidade: item.modalidade,
      custoUnitarioCents: item.custoUnitarioCents,
      custoTotalCents: item.custoTotalCents,
      repasseUnitarioCents: item.repasseUnitarioCents,
      repasseTotalCents: item.repasseTotalCents,
      comissaoBps: item.comissaoBps,
      qtdSemSaldo: item.qtdSemSaldo,
      margemCents: margemItem({ liquido: item.liquidoCents, custoUnit: item.custoUnitarioCents, repasseUnit: item.repasseUnitarioCents, qtd: item.quantidade }),
    };
  });
  return {
    id: venda.id,
    dataEfetiva: venda.dataEfetiva,
    cliente: venda.cliente,
    colaborador: nome(venda.colaboradorId),
    registradoPor: nome(venda.registradoPor),
    autorizadoPor: venda.autorizadoPor ? nome(venda.autorizadoPor) : null,
    brutoCents: venda.brutoCents,
    descontoItensCents: venda.descontoItensCents,
    descontoTotalCents: venda.descontoTotalCents,
    liquidoCents: venda.liquidoCents,
    situacao: venda.situacao,
    estoqueNegativo: venda.estoqueNegativo,
    margemNegativa: admin ? venda.margemNegativa : undefined,
    criadoEm: venda.criadoEm,
    itens: itensVisao,
    pagamentos: pagamentos.map((p) => ({ forma: p.forma, valorCents: p.valorCents })),
    devolucoes: devolucoes.map((d) => ({ vendaItemId: d.vendaItemId, quantidade: d.quantidade, dataEfetiva: d.dataEfetiva, liquidoCents: d.liquidoCents, justificativa: d.justificativa })),
  };
}
