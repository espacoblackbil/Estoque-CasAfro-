# Matriz de rastreabilidade — especificação × código × testes

Testes em `tests/` (rodam em PostgreSQL real: PGlite por padrão ou servidor via `TEST_DATABASE_URL`).

| Spec | Requisito | Implementação | Testes |
|---|---|---|---|
| §2 | Interface minimalista, cores pastel, mobile-first | `src/app/globals.css`, `src/components/Nav.tsx`, `src/app/(app)/**` | verificação visual (Playwright, celular 390px e computador) |
| §3 | Perfis principal/admin/colaborador; senhas com hash | `services/usuarios.ts`, `services/permissoes.ts` | `m1` — autenticação, perfis; `m4` — critério 9 |
| §3.3 | Colaborador sem custos/lucros/repasses/comissões alheias | `cadastros.listarProdutosPublico`, `vendas.obterVenda`, `comissoes.extratoComissoes` | `m2` — visão restrita; `m4` — critério 9; `m7` — dashboard bloqueado; `m8` — relatórios bloqueados |
| §4 | Cadastro de produto, modalidade única, comissão padrão 0 | `services/cadastros.ts` | `m2` |
| §4 | Estoque mínimo global | `configuracoes.estoqueMinimo`, `financeiro.dashboard` | `m1`, `m7` |
| §5 | Fornecedor com CPF/CNPJ | `cadastros.salvarFornecedor`, `documentoValido` | `m2` |
| §5 | Custo médio ponderado (próprio) | `estoque.lancarEntrada` | `m3` — custo médio |
| §5 | Repasse em venda/consumo/perda/dano; não em devolução ao fornecedor | `estoque.lancarSaida`, `EFEITO_CLASSIFICACAO` | `m3` — consignado; `m7` — critério 3; `m8` — fornecedor |
| §6 | 8 tipos de movimentação com tipo, qtd, datas e usuário | `schema.movimentacoes`, `services/estoque.ts`, `vendas.devolverVenda` | `m3`, `m4` |
| §6 | Justificativa obrigatória em correções | `ajustarInventario`, `anularMovimentacao`, `corrigirMovimentacao` | `m3` |
| §6 | Estoque negativo permitido e destacado | `lancarSaida` (pendentes), `vendas.estoqueNegativo` | `m3`, `m4` — critério 5 |
| §6 | Divergência classificada antes do repasse | `ajustarInventario` | `m3` |
| §6 | Retroativo com valores da época | overrides em `registrarSaida`/`registrarVenda` | `m3`, `m4` — critério 7 |
| §6 | Saldo inicial e reconciliação sem duplicar | `definirSaldoInicial`, `afetaEstoque` | `m3` |
| §7 | Venda multi-item, pagamento dividido que fecha no total | `vendas.registrarVenda` | `m4` — critério 1 |
| §7 | Desconto só admin, rateio proporcional | `calcularItens`, `ratear` | `m1` — rateio; `m4` — critério 2 |
| §7 | Margem negativa exige autorização | `ErroMargemNegativa`, `autorizacaoAdmin` | `m4` |
| §8 | Comissão por produto sobre o líquido; estorno; ajuste negativo | `vendas`, `services/comissoes.ts` | `m4` — critérios 2 e 6 |
| §8 | Pagamentos parciais/integrais, extrato | `registrarPagamentoComissao`, `extratoComissoes` | `m4`, `m8` |
| §9 | Linhas do resultado sem duplicidade; não é lucro do salão | `financeiro.apurarResultado` | `m7` |
| §9 | Valores históricos não mudam com novos preços | colunas congeladas em `venda_itens`/`movimentacoes` | `m4` — critério 7 |
| §10 | Dashboard | `financeiro.dashboard`, `src/app/(app)/page.tsx` | `m7` |
| §11.1–11.3 | PDFs geral, fornecedor, colaborador | `services/relatorios.ts`, `server/pdf/documento.ts` | `m8` — critério 10 |
| §11.4 | Retificação com versões preservadas | `emitirRelatorio`, `relatorio_emissoes` | `m8` — critério 8 |
| §12 | Central de Relatórios / fechamento | `relatorios.fechamento`, `src/app/(app)/relatorios` | `m8` |
| §13 | Auditoria imutável, nada apagado, sem duplicidade | `services/auditoria.ts`, gatilhos `0001`/`0002`, `chave_idempotencia` | `m1`, `m3`, `m4` (idempotência em paralelo), `m8` |
| §14 | Configurações e logotipo nos relatórios | `services/configuracoes.ts`, `src/app/(app)/configuracoes` | `m1` |
| §15 | Banco persistente, auth segura, backup | `server/db`, `scripts/backup.ts`, `docs/ARQUITETURA.md` | suíte com `TEST_DATABASE_URL` |

## Critérios mínimos de funcionamento (§17)

| # | Critério | Teste |
|---|---|---|
| 1 | Venda com múltiplos produtos e pagamento dividido | `m4-vendas-comissoes` › critério 1 |
| 2 | Descontos com comissões e repasses corretos | `m4-vendas-comissoes` › critério 2 |
| 3 | Consumo interno de consignado: repasse sem faturamento | `m7-financeiro` › critério 3 |
| 4 | Perdas, danos e diferenças de inventário | `m3-estoque` › consumo/perda/dano; divergência de inventário |
| 5 | Venda com estoque negativo e regularização | `m3-estoque` › estoque negativo; `m4` › critério 5 |
| 6 | Cancelar venda com comissão já paga | `m4-vendas-comissoes` › critério 6 |
| 7 | Retroativo preservando valores históricos | `m3-estoque` › retroativo; `m4` › critério 7 |
| 8 | Corrigir movimentação e emitir relatório retificado | `m8-relatorios` › critério 8 |
| 9 | Colaborador sem acesso a dados restritos | `m4` › critério 9 (+ `m2`, `m7`, `m8`) |
| 10 | Totais dos PDFs = base de dados | `m8-relatorios` › critério 10 (texto extraído do PDF) |
