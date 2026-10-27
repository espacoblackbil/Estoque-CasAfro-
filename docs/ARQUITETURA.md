# Arquitetura — CasAfro Gestão

## Visão geral

```
Navegador (celular/computador)
   │  HTML renderizado no servidor + Server Actions (formulários)
   ▼
Next.js 15 (App Router, TypeScript)  ── src/app/**            telas; nenhuma regra de negócio
   │
   ▼
Camada de serviço                     ── src/server/services/**  TODAS as regras e permissões
   │  Drizzle ORM, transações
   ▼
PostgreSQL                            ── drizzle/*.sql           esquema + gatilhos de proteção do histórico
```

| Camada | Tecnologia | Por quê |
|---|---|---|
| Aplicação web | **Next.js 15 + React 19** | Uma única aplicação (telas + servidor), sem API separada para manter. Server Actions já protegem contra CSRF (verificação de origem). |
| Banco | **PostgreSQL** | Transações ACID, `SELECT … FOR UPDATE`, gatilhos, índices únicos — exatamente o que a contabilidade de estoque precisa. |
| Acesso a dados | **Drizzle ORM** | SQL tipado, migrações em SQL legível e versionado em `drizzle/`. |
| PDF | **pdfkit** | Geração no servidor, sem navegador headless; leve para hospedagem gratuita. |
| Senhas | **bcrypt** (custo 10) | Nunca em texto simples (spec §3). |
| Testes | **Vitest + PGlite** | PGlite é o PostgreSQL real compilado para WebAssembly: `npm test` roda as migrações reais sem instalar nada. Com `TEST_DATABASE_URL` a mesma suíte roda num servidor PostgreSQL. |

### Hospedagem recomendada (gratuita, sem perda de dados — spec §15)

- **Aplicação:** Vercel (plano Hobby) — endereço `*.vercel.app` gratuito, domínio próprio configurável depois.
- **Banco:** Neon (PostgreSQL gerenciado, plano gratuito) — armazenamento persistente, *point-in-time restore*
  (restauração para qualquer instante recente) e conexões com TLS. Alternativa equivalente: Supabase.
- **Backup adicional:** `npm run backup` gera um `pg_dump` completo (formato custom) para guardar fora do provedor.
  Recomenda-se executá-lo ao menos após cada fechamento mensal.

Em produção a aplicação **recusa-se a iniciar sem `DATABASE_URL`** — não existe modo "temporário".
O banco embutido (PGlite em `./.data`) só é usado em desenvolvimento local.

## Modelo de dados

| Tabela | Conteúdo | Proteção |
|---|---|---|
| `usuarios`, `sessoes` | Contas (hash bcrypt), papéis `principal`/`admin`/`colaborador`; sessões guardam só o SHA-256 do token. | Usuários não podem ser apagados (só desativados). |
| `configuracoes` | Dados da empresa, logotipo, estoque mínimo global. | Linha única. |
| `categorias`, `fornecedores`, `produtos` | Cadastros. `produtos.quantidade` é um cache do saldo. | Produtos e fornecedores não podem ser apagados. |
| `movimentacoes` | Todo evento de estoque com valores **congelados** (custo, repasse, fornecedor, modalidade). | Sem DELETE; UPDATE só nas colunas de anulação. Anulada não volta a valer. |
| `vendas`, `venda_itens`, `venda_pagamentos` | Venda, itens com rateio de desconto, comissão e custo congelados. | Sem DELETE; itens só atualizam `qtd_devolvida`; pagamentos imutáveis. |
| `venda_devolucoes` | Cancelamentos/devoluções com valores estornados. | Imutável. |
| `comissao_lancamentos`, `comissao_pagamentos` | Razão de comissões (gerada/estorno/ajuste negativo) e pagamentos. | Imutáveis. |
| `relatorio_emissoes` | Cada versão de cada PDF: dados, hash, PDF, emissor. | Imutável. |
| `auditoria` | Antes/depois/justificativa/usuário/data de cada alteração relevante. | Imutável. |

As proteções são **gatilhos no banco** (`drizzle/0001_protecao_historico.sql`): mesmo um acesso direto ao SQL não
consegue apagar ou reescrever o histórico sem desativar os gatilhos.

## Regras de cálculo

- **Dinheiro em centavos inteiros**; percentuais em pontos-base (10% = 1000). Arredondamento meio-para-cima.
- **Custo médio ponderado** (próprios): `novo = (saldo_positivo × médio + qtd × custo) / (saldo_positivo + qtd)`,
  na ordem de registro das entradas.
- **Rateio do desconto total**: proporcional ao valor de cada item após o desconto do item, pelo método dos
  maiores restos — a soma dos itens fecha exatamente no total da venda.
- **Comissão** = líquido do item × % do produto, arredondada por item.
- **Devolução parcial**: valor acumulado das primeiras *k* unidades de *q* = `arred(total × k / q)`; cada devolução
  estorna a diferença, e a última fecha exatamente no total do item.
- **Resultado estimado** = receita líquida − CMV próprio (inclui ajustes de estoque negativo) − repasses de consignados
  vendidos − comissões − consumo interno − perdas e danos. O repasse de consumo/perda de consignado entra **só** na
  linha de consumo/perda (sem duplicar).
- **Devido ao fornecedor** = Σ `repasse_total_cents` das movimentações ativas do período (vendas + consumo + perdas/danos
  − devoluções de venda). Devolução ao fornecedor tem repasse zero.

## Decisões de interpretação

Pontos em que a especificação admite mais de uma leitura. Em todos, escolhemos a opção mais segura para os números.

| # | Tema (seção) | Decisão |
|---|---|---|
| D1 | Quem gerencia contas (§3) | Principal gerencia administradores e colaboradores; administrador gerencia **somente colaboradores**. Ninguém cria outro principal pela interface (só a tela `/setup`, uma única vez, com `SETUP_TOKEN`). |
| D2 | Colaborador responsável (§7) | Colaborador registra vendas **apenas em seu próprio nome** (evita atribuir comissão a terceiros). Administradores escolhem qualquer usuário ativo, inclusive administradores. |
| D3 | Vendas retroativas (§6) | Somente administradores. Podem informar preço, custo, repasse e % de comissão praticados na época. |
| D4 | Margem negativa (§7) | Item com líquido < custo (próprio) ou < repasse (consignado). Administrador confirma marcando a autorização; colaborador precisa do usuário e senha de um administrador, verificados no servidor. O autorizador fica gravado na venda. |
| D5 | Estorno de comissão já paga (§8) | Razão por colaborador: o estorno consome primeiro o saldo pendente (lançamento "estorno"); o que exceder — a parte já paga — vira "ajuste negativo" a compensar. Pagamentos nunca são alterados. Pagamento maior que o saldo pendente é recusado. |
| D6 | Divergência de inventário (§6) | A classificação é exigida para **toda** falta (próprio ou consignado): perda, dano e consumo interno têm efeito financeiro (repasse para consignado, custo para próprio); devolução ao fornecedor e erro de registro não. Sobras não têm efeito financeiro. Justificativa sempre obrigatória. |
| D7 | Estoque negativo (§9) | Unidades vendidas/baixadas além do saldo recebem custo estimado (custo médio vigente) e ficam "pendentes". A entrada que regulariza lança `ajuste_custo` = (custo real − estimado) na data da entrada, somado ao CMV. A venda e o seu item mostram o selo de estoque negativo. |
| D8 | Saldo inicial (§6) | Um por produto. Movimentações com data **anterior** à implantação valem para o financeiro (vendas, repasses, comissões) mas não alteram o saldo; as posteriores somam ao saldo informado. |
| D9 | Correções (§6, §13) | Entradas e saídas administrativas são corrigidas por anulação + novo lançamento vinculado (`corrige_id`/`substituida_por`), com justificativa obrigatória. Vendas são corrigidas por cancelamento/devolução. Uma entrada que regularizou estoque negativo não pode ser anulada (corrige-se por inventário). |
| D10 | Custo médio e retroativos (§9) | O custo médio segue a ordem de registro. Entradas retroativas atualizam o médio a partir do registro; saídas já gravadas mantêm o custo congelado (nunca são recalculadas silenciosamente). |
| D11 | Datas dos estornos (§9, §11) | Cancelamentos/devoluções contam na data efetiva informada (padrão: hoje; nunca antes da venda). Assim um mês já fechado só muda se a correção for lançada com data dentro dele — e aí gera relatório retificado. |
| D12 | Retificação (§11.4) | Cada relatório guarda o hash dos dados. Reemitir sem mudanças devolve a mesma versão; com mudanças cria a versão *n+1* marcada "RETIFICADO", com a tabela de diferenças e os registros de auditoria que a originaram. A posição atual do estoque é um retrato do momento e não entra no hash. |
| D13 | Faturamento no painel (§10) | "Faturamento" mostra a receita líquida (após descontos e devoluções); o bruto aparece como detalhe. |
| D14 | Quantidades | Sempre unidades inteiras (spec exige para consumo interno; adotado para todo o estoque, já que não há fracionamento). |

## Segurança

- Sessão: token aleatório de 256 bits em cookie `httpOnly`, `secure` (produção), `sameSite=lax`; no banco só o SHA-256.
- Todas as permissões são verificadas na camada de serviço; a interface apenas esconde o que já seria recusado.
- Colaboradores recebem DTOs sem custo, repasse, margem, % de comissão ou dados de outros colaboradores (teste `critério 9`).
- PDFs só são servidos a administradores (rota verifica a sessão; resposta 403 caso contrário).
- Cabeçalhos: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`.
- Login com comparação em tempo constante mesmo para usuário inexistente.
