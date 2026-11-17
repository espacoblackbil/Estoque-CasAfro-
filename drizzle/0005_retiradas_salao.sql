CREATE TABLE "retiradas_salao" (
	"id" serial PRIMARY KEY NOT NULL,
	"chave_idempotencia" text NOT NULL,
	"data_efetiva" date NOT NULL,
	"usuario_id" integer NOT NULL,
	"observacao" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "movimentacoes" ADD COLUMN "retirada_id" integer;--> statement-breakpoint
ALTER TABLE "retiradas_salao" ADD CONSTRAINT "retiradas_salao_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "retiradas_idem_uq" ON "retiradas_salao" USING btree ("chave_idempotencia");--> statement-breakpoint
CREATE TRIGGER retiradas_imutavel BEFORE UPDATE OR DELETE ON retiradas_salao FOR EACH ROW EXECUTE FUNCTION impedir_alteracao();
