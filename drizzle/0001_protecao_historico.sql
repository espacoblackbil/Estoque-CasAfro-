-- Proteção do histórico (spec §13): nada financeiro é apagado; auditoria é imutável;
-- registros financeiros só aceitam alteração nas colunas de controle listadas.
CREATE OR REPLACE FUNCTION impedir_exclusao() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Exclusão não permitida em % (histórico protegido)', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION impedir_alteracao() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Alteração não permitida em % (histórico protegido)', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION somente_colunas_permitidas() RETURNS trigger AS $$
DECLARE
  k text;
  novo jsonb := to_jsonb(NEW);
  velho jsonb := to_jsonb(OLD);
BEGIN
  FOR k IN SELECT jsonb_object_keys(novo) LOOP
    IF NOT (k = ANY(TG_ARGV)) AND (novo -> k) IS DISTINCT FROM (velho -> k) THEN
      RAISE EXCEPTION 'Alteração da coluna %.% não permitida (histórico protegido)', TG_TABLE_NAME, k;
    END IF;
  END LOOP;
  IF (velho ? 'anulada') AND (velho ->> 'anulada')::boolean AND NOT (novo ->> 'anulada')::boolean THEN
    RAISE EXCEPTION 'Uma movimentação anulada não pode ser reativada';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER auditoria_imutavel BEFORE UPDATE OR DELETE ON auditoria FOR EACH ROW EXECUTE FUNCTION impedir_alteracao();
--> statement-breakpoint
CREATE TRIGGER relatorio_imutavel BEFORE UPDATE OR DELETE ON relatorio_emissoes FOR EACH ROW EXECUTE FUNCTION impedir_alteracao();
--> statement-breakpoint
CREATE TRIGGER comissao_lanc_imutavel BEFORE UPDATE OR DELETE ON comissao_lancamentos FOR EACH ROW EXECUTE FUNCTION impedir_alteracao();
--> statement-breakpoint
CREATE TRIGGER comissao_pag_imutavel BEFORE UPDATE OR DELETE ON comissao_pagamentos FOR EACH ROW EXECUTE FUNCTION impedir_alteracao();
--> statement-breakpoint
CREATE TRIGGER venda_pag_imutavel BEFORE UPDATE OR DELETE ON venda_pagamentos FOR EACH ROW EXECUTE FUNCTION impedir_alteracao();
--> statement-breakpoint
CREATE TRIGGER vendas_sem_exclusao BEFORE DELETE ON vendas FOR EACH ROW EXECUTE FUNCTION impedir_exclusao();
--> statement-breakpoint
CREATE TRIGGER vendas_colunas BEFORE UPDATE ON vendas FOR EACH ROW EXECUTE FUNCTION somente_colunas_permitidas('situacao');
--> statement-breakpoint
CREATE TRIGGER venda_itens_sem_exclusao BEFORE DELETE ON venda_itens FOR EACH ROW EXECUTE FUNCTION impedir_exclusao();
--> statement-breakpoint
CREATE TRIGGER venda_itens_colunas BEFORE UPDATE ON venda_itens FOR EACH ROW EXECUTE FUNCTION somente_colunas_permitidas('qtd_devolvida');
--> statement-breakpoint
CREATE TRIGGER mov_sem_exclusao BEFORE DELETE ON movimentacoes FOR EACH ROW EXECUTE FUNCTION impedir_exclusao();
--> statement-breakpoint
CREATE TRIGGER mov_colunas BEFORE UPDATE ON movimentacoes FOR EACH ROW EXECUTE FUNCTION somente_colunas_permitidas('anulada', 'anulada_em', 'anulada_por', 'substituida_por', 'afeta_estoque');
--> statement-breakpoint
CREATE TRIGGER produtos_sem_exclusao BEFORE DELETE ON produtos FOR EACH ROW EXECUTE FUNCTION impedir_exclusao();
--> statement-breakpoint
CREATE TRIGGER usuarios_sem_exclusao BEFORE DELETE ON usuarios FOR EACH ROW EXECUTE FUNCTION impedir_exclusao();
--> statement-breakpoint
CREATE TRIGGER fornecedores_sem_exclusao BEFORE DELETE ON fornecedores FOR EACH ROW EXECUTE FUNCTION impedir_exclusao();
--> statement-breakpoint
INSERT INTO configuracoes (id) VALUES (1) ON CONFLICT DO NOTHING;
