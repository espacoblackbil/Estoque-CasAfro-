CREATE TABLE "venda_devolucoes" (
	"id" serial PRIMARY KEY NOT NULL,
	"venda_id" integer NOT NULL,
	"venda_item_id" integer NOT NULL,
	"quantidade" integer NOT NULL,
	"data_efetiva" date NOT NULL,
	"bruto_cents" integer NOT NULL,
	"desconto_cents" integer NOT NULL,
	"liquido_cents" integer NOT NULL,
	"custo_cents" integer NOT NULL,
	"repasse_cents" integer NOT NULL,
	"comissao_cents" integer NOT NULL,
	"justificativa" text NOT NULL,
	"usuario_id" integer NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devolucao_qtd_ok" CHECK ("venda_devolucoes"."quantidade" > 0)
);
--> statement-breakpoint
ALTER TABLE "venda_devolucoes" ADD CONSTRAINT "venda_devolucoes_venda_id_vendas_id_fk" FOREIGN KEY ("venda_id") REFERENCES "public"."vendas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venda_devolucoes" ADD CONSTRAINT "venda_devolucoes_venda_item_id_venda_itens_id_fk" FOREIGN KEY ("venda_item_id") REFERENCES "public"."venda_itens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venda_devolucoes" ADD CONSTRAINT "venda_devolucoes_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "venda_dev_data_idx" ON "venda_devolucoes" USING btree ("data_efetiva");--> statement-breakpoint
CREATE TRIGGER venda_dev_imutavel BEFORE UPDATE OR DELETE ON venda_devolucoes FOR EACH ROW EXECUTE FUNCTION impedir_alteracao();
