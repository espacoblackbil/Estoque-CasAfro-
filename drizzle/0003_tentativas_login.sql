CREATE TABLE "tentativas_login" (
	"id" serial PRIMARY KEY NOT NULL,
	"login" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "tentativas_login_idx" ON "tentativas_login" USING btree ("login","criado_em");