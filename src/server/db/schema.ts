/**
 * Esquema do banco — CasAfro Gestão.
 *
 * Convenções:
 *  - valores monetários em centavos inteiros (`*_cents`);
 *  - percentuais em pontos-base (`*_bps`, 10% = 1000);
 *  - datas efetivas (`data_efetiva`) em `date` (calendário de São Paulo); instantes em `timestamptz`.
 *  - nada é apagado: tabelas financeiras têm gatilho anti-DELETE (ver migração 0001).
 */
import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  date,
  jsonb,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";

export const papelEnum = pgEnum("papel", ["principal", "admin", "colaborador"]);
export const modalidadeEnum = pgEnum("modalidade", ["proprio", "consignado"]);
export const tipoMovimentoEnum = pgEnum("tipo_movimento", [
  "saldo_inicial",
  "entrada",
  "venda",
  "consumo_interno",
  "perda",
  "dano",
  "devolucao_fornecedor",
  "ajuste_inventario",
  "devolucao_venda",
]);
/** Classificação obrigatória de divergências negativas de inventário (spec §6). */
export const classificacaoEnum = pgEnum("classificacao_divergencia", [
  "perda",
  "dano",
  "consumo_interno",
  "devolucao_fornecedor",
  "erro_registro",
]);
export const formaPagamentoEnum = pgEnum("forma_pagamento", ["pix", "dinheiro", "debito", "credito"]);
export const tipoComissaoEnum = pgEnum("tipo_lancamento_comissao", ["gerada", "estorno", "ajuste_negativo"]);
export const tipoRelatorioEnum = pgEnum("tipo_relatorio", ["geral", "fornecedor", "colaborador", "comissoes"]);

const criadoEm = () => timestamp("criado_em", { withTimezone: true }).notNull().defaultNow();

// ───────────────────────────── Fundação ─────────────────────────────

export const configuracoes = pgTable("configuracoes", {
  id: integer("id").primaryKey().default(1),
  nomeFantasia: text("nome_fantasia").notNull().default("CasAfro"),
  razaoSocial: text("razao_social").notNull().default(""),
  cnpj: text("cnpj").notNull().default("41.915.055/0001-09"),
  endereco: text("endereco").notNull().default(""),
  telefone: text("telefone").notNull().default(""),
  /** PNG/JPEG em base64 (data URL). Vazio = logotipo padrão em /public. */
  logotipo: text("logotipo").notNull().default(""),
  estoqueMinimo: integer("estoque_minimo").notNull().default(3),
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check("configuracoes_unica", sql`${t.id} = 1`)]);

export const usuarios = pgTable("usuarios", {
  id: serial("id").primaryKey(),
  nome: text("nome").notNull(),
  login: text("login").notNull(),
  senhaHash: text("senha_hash").notNull(),
  papel: papelEnum("papel").notNull(),
  ativo: boolean("ativo").notNull().default(true),
  criadoEm: criadoEm(),
}, (t) => [uniqueIndex("usuarios_login_uq").on(sql`lower(${t.login})`)]);

export const sessoes = pgTable("sessoes", {
  /** sha256 do token enviado no cookie (o token em si nunca é gravado). */
  id: text("id").primaryKey(),
  usuarioId: integer("usuario_id").notNull().references(() => usuarios.id),
  expiraEm: timestamp("expira_em", { withTimezone: true }).notNull(),
  criadoEm: criadoEm(),
});

export const auditoria = pgTable("auditoria", {
  id: serial("id").primaryKey(),
  usuarioId: integer("usuario_id").references(() => usuarios.id),
  acao: text("acao").notNull(),
  entidade: text("entidade").notNull(),
  entidadeId: text("entidade_id"),
  antes: jsonb("antes"),
  depois: jsonb("depois"),
  justificativa: text("justificativa"),
  /** Data efetiva afetada (para identificar retificações de períodos já emitidos). */
  dataEfetiva: date("data_efetiva", { mode: "string" }),
  criadoEm: criadoEm(),
}, (t) => [index("auditoria_criado_idx").on(t.criadoEm)]);

// ───────────────────────────── Cadastros ─────────────────────────────

export const categorias = pgTable("categorias", {
  id: serial("id").primaryKey(),
  nome: text("nome").notNull(),
  ordem: integer("ordem").notNull().default(0),
  ativo: boolean("ativo").notNull().default(true),
}, (t) => [uniqueIndex("categorias_nome_uq").on(sql`lower(${t.nome})`)]);

export const fornecedores = pgTable("fornecedores", {
  id: serial("id").primaryKey(),
  nome: text("nome").notNull(),
  documento: text("documento").notNull().default(""),
  telefone: text("telefone").notNull().default(""),
  ativo: boolean("ativo").notNull().default(true),
  criadoEm: criadoEm(),
});

export const produtos = pgTable("produtos", {
  id: serial("id").primaryKey(),
  nome: text("nome").notNull(),
  categoriaId: integer("categoria_id").references(() => categorias.id),
  fornecedorId: integer("fornecedor_id").references(() => fornecedores.id),
  modalidade: modalidadeEnum("modalidade").notNull(),
  precoVendaCents: integer("preco_venda_cents").notNull(),
  /** Próprio: custo médio ponderado corrente (mantido pelo sistema). */
  custoMedioCents: integer("custo_medio_cents").notNull().default(0),
  /** Consignado: valor fixo de repasse por unidade (vigente). */
  repasseCents: integer("repasse_cents").notNull().default(0),
  comissaoBps: integer("comissao_bps").notNull().default(0),
  /** Saldo calculado = soma das movimentações ativas que afetam estoque. */
  quantidade: integer("quantidade").notNull().default(0),
  /** Unidades vendidas sem saldo, ainda com custo estimado (próprios). */
  pendenteQtd: integer("pendente_qtd").notNull().default(0),
  pendenteCustoCents: integer("pendente_custo_cents").notNull().default(0),
  /** Data do saldo inicial de implantação; movimentos anteriores são só históricos. */
  dataImplantacao: date("data_implantacao", { mode: "string" }),
  ativo: boolean("ativo").notNull().default(true),
  criadoEm: criadoEm(),
}, (t) => [
  check("produto_valores_ok", sql`${t.precoVendaCents} >= 0 and ${t.repasseCents} >= 0 and ${t.comissaoBps} between 0 and 10000`),
  index("produtos_nome_idx").on(t.nome),
]);

// ───────────────────────────── Vendas ─────────────────────────────

export const vendas = pgTable("vendas", {
  id: serial("id").primaryKey(),
  chaveIdempotencia: text("chave_idempotencia").notNull(),
  dataEfetiva: date("data_efetiva", { mode: "string" }).notNull(),
  colaboradorId: integer("colaborador_id").notNull().references(() => usuarios.id),
  registradoPor: integer("registrado_por").notNull().references(() => usuarios.id),
  cliente: text("cliente"),
  brutoCents: integer("bruto_cents").notNull(),
  descontoItensCents: integer("desconto_itens_cents").notNull().default(0),
  descontoTotalCents: integer("desconto_total_cents").notNull().default(0),
  liquidoCents: integer("liquido_cents").notNull(),
  margemNegativa: boolean("margem_negativa").notNull().default(false),
  autorizadoPor: integer("autorizado_por").references(() => usuarios.id),
  estoqueNegativo: boolean("estoque_negativo").notNull().default(false),
  /** ativa | cancelada | devolvida_parcial */
  situacao: text("situacao").notNull().default("ativa"),
  criadoEm: criadoEm(),
}, (t) => [
  uniqueIndex("vendas_idem_uq").on(t.chaveIdempotencia),
  index("vendas_data_idx").on(t.dataEfetiva),
]);

export const vendaItens = pgTable("venda_itens", {
  id: serial("id").primaryKey(),
  vendaId: integer("venda_id").notNull().references(() => vendas.id),
  produtoId: integer("produto_id").notNull().references(() => produtos.id),
  /** Valores congelados no momento da venda. */
  modalidade: modalidadeEnum("modalidade").notNull(),
  fornecedorId: integer("fornecedor_id").references(() => fornecedores.id),
  quantidade: integer("quantidade").notNull(),
  precoUnitarioCents: integer("preco_unitario_cents").notNull(),
  brutoCents: integer("bruto_cents").notNull(),
  descontoItemCents: integer("desconto_item_cents").notNull().default(0),
  descontoRateadoCents: integer("desconto_rateado_cents").notNull().default(0),
  liquidoCents: integer("liquido_cents").notNull(),
  custoUnitarioCents: integer("custo_unitario_cents").notNull().default(0),
  custoTotalCents: integer("custo_total_cents").notNull().default(0),
  repasseUnitarioCents: integer("repasse_unitario_cents").notNull().default(0),
  repasseTotalCents: integer("repasse_total_cents").notNull().default(0),
  comissaoBps: integer("comissao_bps").notNull().default(0),
  comissaoCents: integer("comissao_cents").notNull().default(0),
  /** Unidades vendidas além do saldo (custo estimado — próprio). */
  qtdSemSaldo: integer("qtd_sem_saldo").notNull().default(0),
  qtdDevolvida: integer("qtd_devolvida").notNull().default(0),
}, (t) => [
  check("venda_item_qtd_ok", sql`${t.quantidade} > 0 and ${t.qtdDevolvida} between 0 and ${t.quantidade}`),
  index("venda_itens_venda_idx").on(t.vendaId),
]);

export const vendaPagamentos = pgTable("venda_pagamentos", {
  id: serial("id").primaryKey(),
  vendaId: integer("venda_id").notNull().references(() => vendas.id),
  forma: formaPagamentoEnum("forma").notNull(),
  valorCents: integer("valor_cents").notNull(),
}, (t) => [check("pagamento_positivo", sql`${t.valorCents} > 0`)]);

// ───────────────────────────── Estoque ─────────────────────────────

export const movimentacoes = pgTable("movimentacoes", {
  id: serial("id").primaryKey(),
  tipo: tipoMovimentoEnum("tipo").notNull(),
  produtoId: integer("produto_id").notNull().references(() => produtos.id),
  /** Variação de estoque assinada (+ entra, − sai). */
  quantidade: integer("quantidade").notNull(),
  dataEfetiva: date("data_efetiva", { mode: "string" }).notNull(),
  registradoEm: timestamp("registrado_em", { withTimezone: true }).notNull().defaultNow(),
  usuarioId: integer("usuario_id").notNull().references(() => usuarios.id),
  justificativa: text("justificativa"),
  classificacao: classificacaoEnum("classificacao"),
  /** Valores congelados. */
  modalidade: modalidadeEnum("modalidade").notNull(),
  fornecedorId: integer("fornecedor_id").references(() => fornecedores.id),
  custoUnitarioCents: integer("custo_unitario_cents").notNull().default(0),
  /** Impacto de custo no resultado (consumo/perda/dano de próprios; positivo = despesa). */
  custoTotalCents: integer("custo_total_cents").notNull().default(0),
  repasseUnitarioCents: integer("repasse_unitario_cents").notNull().default(0),
  /** Valor devido ao fornecedor gerado por esta movimentação (assinado: devolução de venda estorna). */
  repasseTotalCents: integer("repasse_total_cents").notNull().default(0),
  /** Ajuste de custo por regularização de estoque negativo (próprios). */
  ajusteCustoCents: integer("ajuste_custo_cents").notNull().default(0),
  afetaEstoque: boolean("afeta_estoque").notNull().default(true),
  vendaItemId: integer("venda_item_id").references(() => vendaItens.id),
  /** Correções: a anulada aponta para quem a substituiu. */
  anulada: boolean("anulada").notNull().default(false),
  anuladaEm: timestamp("anulada_em", { withTimezone: true }),
  anuladaPor: integer("anulada_por").references(() => usuarios.id),
  substituidaPor: integer("substituida_por"),
  corrigeId: integer("corrige_id"),
}, (t) => [
  index("mov_produto_idx").on(t.produtoId),
  index("mov_data_idx").on(t.dataEfetiva),
]);

// ───────────────────────────── Comissões ─────────────────────────────

export const comissaoLancamentos = pgTable("comissao_lancamentos", {
  id: serial("id").primaryKey(),
  colaboradorId: integer("colaborador_id").notNull().references(() => usuarios.id),
  tipo: tipoComissaoEnum("tipo").notNull(),
  /** Assinado: gerada > 0; estorno/ajuste_negativo < 0. */
  valorCents: integer("valor_cents").notNull(),
  dataEfetiva: date("data_efetiva", { mode: "string" }).notNull(),
  vendaId: integer("venda_id").references(() => vendas.id),
  vendaItemId: integer("venda_item_id").references(() => vendaItens.id),
  descricao: text("descricao"),
  registradoPor: integer("registrado_por").notNull().references(() => usuarios.id),
  criadoEm: criadoEm(),
}, (t) => [index("comissao_lanc_colab_idx").on(t.colaboradorId)]);

export const comissaoPagamentos = pgTable("comissao_pagamentos", {
  id: serial("id").primaryKey(),
  colaboradorId: integer("colaborador_id").notNull().references(() => usuarios.id),
  valorCents: integer("valor_cents").notNull(),
  dataEfetiva: date("data_efetiva", { mode: "string" }).notNull(),
  observacao: text("observacao"),
  registradoPor: integer("registrado_por").notNull().references(() => usuarios.id),
  criadoEm: criadoEm(),
}, (t) => [check("comissao_pag_positivo", sql`${t.valorCents} > 0`)]);

// ───────────────────────────── Relatórios ─────────────────────────────

export const relatorioEmissoes = pgTable("relatorio_emissoes", {
  id: serial("id").primaryKey(),
  tipo: tipoRelatorioEnum("tipo").notNull(),
  /** fornecedor_id ou colaborador_id; 0 para geral/comissões. */
  escopoId: integer("escopo_id").notNull().default(0),
  inicio: date("inicio", { mode: "string" }).notNull(),
  fim: date("fim", { mode: "string" }).notNull(),
  versao: integer("versao").notNull(),
  retificado: boolean("retificado").notNull().default(false),
  hashDados: text("hash_dados").notNull(),
  dados: jsonb("dados").notNull(),
  /** Alterações detectadas desde a versão anterior (para retificações). */
  alteracoes: jsonb("alteracoes"),
  pdfBase64: text("pdf_base64").notNull(),
  emitidoPor: integer("emitido_por").notNull().references(() => usuarios.id),
  emitidoEm: timestamp("emitido_em", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("relatorio_versao_uq").on(t.tipo, t.escopoId, t.inicio, t.fim, t.versao)]);

/** Cancelamentos/devoluções de venda (parciais ou totais), com valores estornados congelados. */
export const vendaDevolucoes = pgTable("venda_devolucoes", {
  id: serial("id").primaryKey(),
  vendaId: integer("venda_id").notNull().references(() => vendas.id),
  vendaItemId: integer("venda_item_id").notNull().references(() => vendaItens.id),
  quantidade: integer("quantidade").notNull(),
  dataEfetiva: date("data_efetiva", { mode: "string" }).notNull(),
  brutoCents: integer("bruto_cents").notNull(),
  descontoCents: integer("desconto_cents").notNull(),
  liquidoCents: integer("liquido_cents").notNull(),
  custoCents: integer("custo_cents").notNull(),
  repasseCents: integer("repasse_cents").notNull(),
  comissaoCents: integer("comissao_cents").notNull(),
  justificativa: text("justificativa").notNull(),
  usuarioId: integer("usuario_id").notNull().references(() => usuarios.id),
  criadoEm: criadoEm(),
}, (t) => [check("devolucao_qtd_ok", sql`${t.quantidade} > 0`), index("venda_dev_data_idx").on(t.dataEfetiva)]);
