CREATE TYPE "public"."classificacao_divergencia" AS ENUM('perda', 'dano', 'consumo_interno', 'devolucao_fornecedor', 'erro_registro');--> statement-breakpoint
CREATE TYPE "public"."forma_pagamento" AS ENUM('pix', 'dinheiro', 'debito', 'credito');--> statement-breakpoint
CREATE TYPE "public"."modalidade" AS ENUM('proprio', 'consignado');--> statement-breakpoint
CREATE TYPE "public"."papel" AS ENUM('principal', 'admin', 'colaborador');--> statement-breakpoint
CREATE TYPE "public"."tipo_lancamento_comissao" AS ENUM('gerada', 'estorno', 'ajuste_negativo');--> statement-breakpoint
CREATE TYPE "public"."tipo_movimento" AS ENUM('saldo_inicial', 'entrada', 'venda', 'consumo_interno', 'perda', 'dano', 'devolucao_fornecedor', 'ajuste_inventario', 'devolucao_venda');--> statement-breakpoint
CREATE TYPE "public"."tipo_relatorio" AS ENUM('geral', 'fornecedor', 'colaborador', 'comissoes');--> statement-breakpoint
CREATE TABLE "auditoria" (
	"id" serial PRIMARY KEY NOT NULL,
	"usuario_id" integer,
	"acao" text NOT NULL,
	"entidade" text NOT NULL,
	"entidade_id" text,
	"antes" jsonb,
	"depois" jsonb,
	"justificativa" text,
	"data_efetiva" date,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categorias" (
	"id" serial PRIMARY KEY NOT NULL,
	"nome" text NOT NULL,
	"ordem" integer DEFAULT 0 NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comissao_lancamentos" (
	"id" serial PRIMARY KEY NOT NULL,
	"colaborador_id" integer NOT NULL,
	"tipo" "tipo_lancamento_comissao" NOT NULL,
	"valor_cents" integer NOT NULL,
	"data_efetiva" date NOT NULL,
	"venda_id" integer,
	"venda_item_id" integer,
	"descricao" text,
	"registrado_por" integer NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comissao_pagamentos" (
	"id" serial PRIMARY KEY NOT NULL,
	"colaborador_id" integer NOT NULL,
	"valor_cents" integer NOT NULL,
	"data_efetiva" date NOT NULL,
	"observacao" text,
	"registrado_por" integer NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comissao_pag_positivo" CHECK ("comissao_pagamentos"."valor_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "configuracoes" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"nome_fantasia" text DEFAULT 'CasAfro' NOT NULL,
	"razao_social" text DEFAULT '' NOT NULL,
	"cnpj" text DEFAULT '41.915.055/0001-09' NOT NULL,
	"endereco" text DEFAULT '' NOT NULL,
	"telefone" text DEFAULT '' NOT NULL,
	"logotipo" text DEFAULT '' NOT NULL,
	"estoque_minimo" integer DEFAULT 3 NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "configuracoes_unica" CHECK ("configuracoes"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "fornecedores" (
	"id" serial PRIMARY KEY NOT NULL,
	"nome" text NOT NULL,
	"documento" text DEFAULT '' NOT NULL,
	"telefone" text DEFAULT '' NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "movimentacoes" (
	"id" serial PRIMARY KEY NOT NULL,
	"tipo" "tipo_movimento" NOT NULL,
	"produto_id" integer NOT NULL,
	"quantidade" integer NOT NULL,
	"data_efetiva" date NOT NULL,
	"registrado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"usuario_id" integer NOT NULL,
	"justificativa" text,
	"classificacao" "classificacao_divergencia",
	"modalidade" "modalidade" NOT NULL,
	"fornecedor_id" integer,
	"custo_unitario_cents" integer DEFAULT 0 NOT NULL,
	"custo_total_cents" integer DEFAULT 0 NOT NULL,
	"repasse_unitario_cents" integer DEFAULT 0 NOT NULL,
	"repasse_total_cents" integer DEFAULT 0 NOT NULL,
	"ajuste_custo_cents" integer DEFAULT 0 NOT NULL,
	"afeta_estoque" boolean DEFAULT true NOT NULL,
	"venda_item_id" integer,
	"anulada" boolean DEFAULT false NOT NULL,
	"anulada_em" timestamp with time zone,
	"anulada_por" integer,
	"substituida_por" integer,
	"corrige_id" integer
);
--> statement-breakpoint
CREATE TABLE "produtos" (
	"id" serial PRIMARY KEY NOT NULL,
	"nome" text NOT NULL,
	"categoria_id" integer,
	"fornecedor_id" integer,
	"modalidade" "modalidade" NOT NULL,
	"preco_venda_cents" integer NOT NULL,
	"custo_medio_cents" integer DEFAULT 0 NOT NULL,
	"repasse_cents" integer DEFAULT 0 NOT NULL,
	"comissao_bps" integer DEFAULT 0 NOT NULL,
	"quantidade" integer DEFAULT 0 NOT NULL,
	"pendente_qtd" integer DEFAULT 0 NOT NULL,
	"pendente_custo_cents" integer DEFAULT 0 NOT NULL,
	"data_implantacao" date,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "produto_valores_ok" CHECK ("produtos"."preco_venda_cents" >= 0 and "produtos"."repasse_cents" >= 0 and "produtos"."comissao_bps" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "relatorio_emissoes" (
	"id" serial PRIMARY KEY NOT NULL,
	"tipo" "tipo_relatorio" NOT NULL,
	"escopo_id" integer DEFAULT 0 NOT NULL,
	"inicio" date NOT NULL,
	"fim" date NOT NULL,
	"versao" integer NOT NULL,
	"retificado" boolean DEFAULT false NOT NULL,
	"hash_dados" text NOT NULL,
	"dados" jsonb NOT NULL,
	"alteracoes" jsonb,
	"pdf_base64" text NOT NULL,
	"emitido_por" integer NOT NULL,
	"emitido_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessoes" (
	"id" text PRIMARY KEY NOT NULL,
	"usuario_id" integer NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usuarios" (
	"id" serial PRIMARY KEY NOT NULL,
	"nome" text NOT NULL,
	"login" text NOT NULL,
	"senha_hash" text NOT NULL,
	"papel" "papel" NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venda_itens" (
	"id" serial PRIMARY KEY NOT NULL,
	"venda_id" integer NOT NULL,
	"produto_id" integer NOT NULL,
	"modalidade" "modalidade" NOT NULL,
	"fornecedor_id" integer,
	"quantidade" integer NOT NULL,
	"preco_unitario_cents" integer NOT NULL,
	"bruto_cents" integer NOT NULL,
	"desconto_item_cents" integer DEFAULT 0 NOT NULL,
	"desconto_rateado_cents" integer DEFAULT 0 NOT NULL,
	"liquido_cents" integer NOT NULL,
	"custo_unitario_cents" integer DEFAULT 0 NOT NULL,
	"custo_total_cents" integer DEFAULT 0 NOT NULL,
	"repasse_unitario_cents" integer DEFAULT 0 NOT NULL,
	"repasse_total_cents" integer DEFAULT 0 NOT NULL,
	"comissao_bps" integer DEFAULT 0 NOT NULL,
	"comissao_cents" integer DEFAULT 0 NOT NULL,
	"qtd_sem_saldo" integer DEFAULT 0 NOT NULL,
	"qtd_devolvida" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "venda_item_qtd_ok" CHECK ("venda_itens"."quantidade" > 0 and "venda_itens"."qtd_devolvida" between 0 and "venda_itens"."quantidade")
);
--> statement-breakpoint
CREATE TABLE "venda_pagamentos" (
	"id" serial PRIMARY KEY NOT NULL,
	"venda_id" integer NOT NULL,
	"forma" "forma_pagamento" NOT NULL,
	"valor_cents" integer NOT NULL,
	CONSTRAINT "pagamento_positivo" CHECK ("venda_pagamentos"."valor_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "vendas" (
	"id" serial PRIMARY KEY NOT NULL,
	"chave_idempotencia" text NOT NULL,
	"data_efetiva" date NOT NULL,
	"colaborador_id" integer NOT NULL,
	"registrado_por" integer NOT NULL,
	"cliente" text,
	"bruto_cents" integer NOT NULL,
	"desconto_itens_cents" integer DEFAULT 0 NOT NULL,
	"desconto_total_cents" integer DEFAULT 0 NOT NULL,
	"liquido_cents" integer NOT NULL,
	"margem_negativa" boolean DEFAULT false NOT NULL,
	"autorizado_por" integer,
	"estoque_negativo" boolean DEFAULT false NOT NULL,
	"situacao" text DEFAULT 'ativa' NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comissao_lancamentos" ADD CONSTRAINT "comissao_lancamentos_colaborador_id_usuarios_id_fk" FOREIGN KEY ("colaborador_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comissao_lancamentos" ADD CONSTRAINT "comissao_lancamentos_venda_id_vendas_id_fk" FOREIGN KEY ("venda_id") REFERENCES "public"."vendas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comissao_lancamentos" ADD CONSTRAINT "comissao_lancamentos_venda_item_id_venda_itens_id_fk" FOREIGN KEY ("venda_item_id") REFERENCES "public"."venda_itens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comissao_lancamentos" ADD CONSTRAINT "comissao_lancamentos_registrado_por_usuarios_id_fk" FOREIGN KEY ("registrado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comissao_pagamentos" ADD CONSTRAINT "comissao_pagamentos_colaborador_id_usuarios_id_fk" FOREIGN KEY ("colaborador_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comissao_pagamentos" ADD CONSTRAINT "comissao_pagamentos_registrado_por_usuarios_id_fk" FOREIGN KEY ("registrado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimentacoes" ADD CONSTRAINT "movimentacoes_produto_id_produtos_id_fk" FOREIGN KEY ("produto_id") REFERENCES "public"."produtos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimentacoes" ADD CONSTRAINT "movimentacoes_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimentacoes" ADD CONSTRAINT "movimentacoes_fornecedor_id_fornecedores_id_fk" FOREIGN KEY ("fornecedor_id") REFERENCES "public"."fornecedores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimentacoes" ADD CONSTRAINT "movimentacoes_venda_item_id_venda_itens_id_fk" FOREIGN KEY ("venda_item_id") REFERENCES "public"."venda_itens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimentacoes" ADD CONSTRAINT "movimentacoes_anulada_por_usuarios_id_fk" FOREIGN KEY ("anulada_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "produtos" ADD CONSTRAINT "produtos_categoria_id_categorias_id_fk" FOREIGN KEY ("categoria_id") REFERENCES "public"."categorias"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "produtos" ADD CONSTRAINT "produtos_fornecedor_id_fornecedores_id_fk" FOREIGN KEY ("fornecedor_id") REFERENCES "public"."fornecedores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relatorio_emissoes" ADD CONSTRAINT "relatorio_emissoes_emitido_por_usuarios_id_fk" FOREIGN KEY ("emitido_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessoes" ADD CONSTRAINT "sessoes_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venda_itens" ADD CONSTRAINT "venda_itens_venda_id_vendas_id_fk" FOREIGN KEY ("venda_id") REFERENCES "public"."vendas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venda_itens" ADD CONSTRAINT "venda_itens_produto_id_produtos_id_fk" FOREIGN KEY ("produto_id") REFERENCES "public"."produtos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venda_itens" ADD CONSTRAINT "venda_itens_fornecedor_id_fornecedores_id_fk" FOREIGN KEY ("fornecedor_id") REFERENCES "public"."fornecedores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venda_pagamentos" ADD CONSTRAINT "venda_pagamentos_venda_id_vendas_id_fk" FOREIGN KEY ("venda_id") REFERENCES "public"."vendas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendas" ADD CONSTRAINT "vendas_colaborador_id_usuarios_id_fk" FOREIGN KEY ("colaborador_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendas" ADD CONSTRAINT "vendas_registrado_por_usuarios_id_fk" FOREIGN KEY ("registrado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendas" ADD CONSTRAINT "vendas_autorizado_por_usuarios_id_fk" FOREIGN KEY ("autorizado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auditoria_criado_idx" ON "auditoria" USING btree ("criado_em");--> statement-breakpoint
CREATE UNIQUE INDEX "categorias_nome_uq" ON "categorias" USING btree (lower("nome"));--> statement-breakpoint
CREATE INDEX "comissao_lanc_colab_idx" ON "comissao_lancamentos" USING btree ("colaborador_id");--> statement-breakpoint
CREATE INDEX "mov_produto_idx" ON "movimentacoes" USING btree ("produto_id");--> statement-breakpoint
CREATE INDEX "mov_data_idx" ON "movimentacoes" USING btree ("data_efetiva");--> statement-breakpoint
CREATE INDEX "produtos_nome_idx" ON "produtos" USING btree ("nome");--> statement-breakpoint
CREATE UNIQUE INDEX "relatorio_versao_uq" ON "relatorio_emissoes" USING btree ("tipo","escopo_id","inicio","fim","versao");--> statement-breakpoint
CREATE UNIQUE INDEX "usuarios_login_uq" ON "usuarios" USING btree (lower("login"));--> statement-breakpoint
CREATE INDEX "venda_itens_venda_idx" ON "venda_itens" USING btree ("venda_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vendas_idem_uq" ON "vendas" USING btree ("chave_idempotencia");--> statement-breakpoint
CREATE INDEX "vendas_data_idx" ON "vendas" USING btree ("data_efetiva");