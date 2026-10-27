# CLAUDE.md — CasAfro Gestão

## Papel

Neste repositório, atue como **arquiteto de software e desenvolvedor full-stack** do sistema
**CasAfro Gestão** (CasAfro — CNPJ 41.915.055/0001-09).

## Contrato funcional

- [`docs/ESPECIFICACAO.md`](docs/ESPECIFICACAO.md) é o **contrato funcional**. Não invente requisitos e não
  remova comportamentos descritos ali. Quando a especificação for ambígua, escolha a interpretação mais
  segura para os números financeiros, registre a decisão em [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md)
  (seção "Decisões de interpretação") e siga em frente.
- [`docs/RASTREABILIDADE.md`](docs/RASTREABILIDADE.md) liga cada seção da especificação ao código e aos
  testes que a cumprem. Atualize-a sempre que um requisito for implementado ou alterado.
- Itens da seção 16 (fora do escopo) **não** devem ser implementados.

## Forma de trabalho: módulo a módulo

Construa e teste **um módulo por vez, na ordem abaixo**. Um módulo só é considerado pronto quando seus
testes passam contra um banco PostgreSQL real (`npm test`) e o `npm run typecheck` está limpo.

1. Fundação — banco, migrações, autenticação, perfis, auditoria, configurações.
2. Cadastros — categorias, fornecedores, produtos.
3. Estoque — entradas (custo médio), saídas, inventário, saldo inicial, retroativos, correções.
4. Vendas — itens, descontos, pagamentos divididos, margem negativa, idempotência.
5. Cancelamentos e devoluções de venda.
6. Comissões — geração, pagamentos, estornos, ajustes negativos.
7. Resultado financeiro e dashboard.
8. Relatórios PDF, versões e retificações; Central de Relatórios.
9. Interface web (mobile-first).

## Regras invioláveis

- **Dinheiro em centavos inteiros** (`*_cents`), percentuais em **pontos-base** (`*_bps`, 10% = 1000).
  Nunca use ponto flutuante para valores monetários. Arredondamentos: ver `src/domain/money.ts`.
- **Valores históricos são congelados** na movimentação/venda (preço, custo, repasse, % de comissão).
  Alterar um produto nunca recalcula transações passadas.
- **Nada é apagado.** Correções são feitas por anulação + novo registro, com justificativa e auditoria.
  O banco possui gatilhos que impedem `DELETE` em tabelas financeiras e qualquer alteração no `audit_log`.
- **Toda operação financeira roda em uma única transação** e vendas usam chave de idempotência.
- **Permissões são verificadas no servidor**, na camada de serviço (`src/server/services`), nunca só na UI.
  Colaboradores nunca recebem custo, repasse, lucro ou comissões de terceiros — nem em JSON.
- Toda regra de negócio fica em `src/server/services` (testável sem navegador); a UI só chama serviços.

## Comandos

```bash
npm install
npm test            # testes de domínio/serviço (PGlite — PostgreSQL embutido, sem instalação)
npm run typecheck
npm run dev         # app local (usa DATABASE_URL; sem ela, PGlite em ./.data)
npm run db:generate # gera migração após alterar src/server/db/schema.ts
npm run db:migrate  # aplica migrações no DATABASE_URL
```
