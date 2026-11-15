ALTER TYPE "public"."tipo_relatorio" ADD VALUE 'inventario';--> statement-breakpoint
DROP INDEX "relatorio_versao_uq";--> statement-breakpoint
ALTER TABLE "relatorio_emissoes" ADD COLUMN "filtro" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "relatorio_versao_uq" ON "relatorio_emissoes" USING btree ("tipo","escopo_id","filtro","inicio","fim","versao");