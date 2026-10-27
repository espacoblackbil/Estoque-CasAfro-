# CasAfro Gestão

Plataforma interna da **CasAfro** (CNPJ 41.915.055/0001-09) para estoque, vendas, consignações, comissões,
fornecedores e relatórios financeiros em PDF — pensada para uso no celular.

- 📄 Contrato funcional: [`docs/ESPECIFICACAO.md`](docs/ESPECIFICACAO.md)
- 🏗️ Arquitetura e decisões: [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md)
- ✅ Requisito × código × teste: [`docs/RASTREABILIDADE.md`](docs/RASTREABILIDADE.md)
- 🤖 Instruções para o Claude atuar no projeto: [`CLAUDE.md`](CLAUDE.md)

## O que o sistema faz

| Área | Destaques |
|---|---|
| **Vendas** | Busca por nome, vários itens, pagamento dividido (Pix, dinheiro, débito, crédito), descontos só por administradores com rateio exato, autorização de margem negativa, proteção contra venda duplicada em falha de conexão. |
| **Estoque** | Entradas com custo médio ponderado, consumo interno, perdas, danos, devolução ao fornecedor, inventário com classificação obrigatória, estoque negativo rastreado, saldo inicial de implantação, lançamentos retroativos, correções por anulação + novo lançamento. |
| **Consignação** | Repasse fixo por unidade, apurado em vendas, consumo, perdas e danos; prestação de contas em PDF por fornecedor. |
| **Comissões** | Percentual por produto sobre o valor líquido; pagamentos parciais; estornos e ajustes negativos sem alterar pagamentos antigos. |
| **Financeiro** | Tela por mês ou intervalo: faturamento bruto, descontos, receita líquida, CMV, repasses, comissões, consumo, perdas e resultado estimado. Painel com rankings e estoque baixo. |
| **Relatórios** | PDFs geral, por fornecedor, por colaborador e de comissões; fechamento mensal em um clique; versões retificadas preservando as anteriores. |
| **Auditoria** | Quem, quando, antes, depois e por quê. O banco impede apagar ou reescrever o histórico. |

## Rodando localmente

Requisitos: Node.js 20+.

```bash
npm install
npm test        # testes contra PostgreSQL embutido (nenhuma instalação necessária)
npm run dev     # http://localhost:3000 — usa PostgreSQL embutido em ./.data se DATABASE_URL não existir
```

No primeiro acesso, a tela **/setup** cria o administrador principal (em desenvolvimento o token é opcional).

Para rodar os testes também contra um servidor PostgreSQL:

```bash
TEST_DATABASE_URL=postgres://usuario:senha@localhost:5432/postgres npm test
```

Teste ponta a ponta no navegador (requer `playwright` instalado): veja as instruções no topo de
[`scripts/e2e.cjs`](scripts/e2e.cjs).

## Colocando no ar (gratuito)

1. **Banco** — crie um projeto no [Neon](https://neon.tech) (PostgreSQL gratuito, persistente, com restauração
   point-in-time). Copie a *connection string* com `sslmode=require`.
2. **Aplicação** — importe este repositório na [Vercel](https://vercel.com) e defina as variáveis:
   - `DATABASE_URL` — a connection string do Neon (ou instale a integração Neon pelo Marketplace da Vercel com o prefixo `NEON`, que cria `NEON_URL`; ela tem prioridade);
   - `SETUP_TOKEN` — um texto longo e aleatório (protege a criação do primeiro administrador).
   O `npm run build` aplica as migrações automaticamente antes de compilar.
3. Acesse `https://<seu-projeto>.vercel.app/setup`, informe o `SETUP_TOKEN` e crie o administrador principal.
   (Alternativa pelo terminal: `DATABASE_URL=... npm run criar-admin -- "Nome" login senha`.)
4. Em **Configurações**, preencha razão social, endereço, telefone, estoque mínimo e (opcional) outro logotipo.
5. Cadastre categorias, fornecedores, produtos e lance o **saldo inicial** de cada produto em **Estoque**.

Domínio próprio: adicione-o depois em *Vercel › Settings › Domains*.

### Ambiente de teste

Antes da publicação oficial, um ambiente de teste pode usar o mesmo caminho acima com um banco Neon separado
(ex.: projeto `casafro-teste`). Na Vercel, aponte *Settings › Environments › Production › Branch Tracking*
para o ramo de desenvolvimento. Ao final dos testes, apague o banco de teste e crie o oficial do zero.

### Backup

Além da restauração do Neon, gere cópias próprias periodicamente (ex.: após cada fechamento):

```bash
DATABASE_URL=... npm run backup                 # cria backups/casafro-<data>.dump
pg_restore --clean --if-exists -d "$DATABASE_URL" backups/casafro-<data>.dump   # restauração
```

## Estrutura

```
src/domain/            dinheiro (centavos/pontos-base), datas, rótulos — funções puras
src/server/db/         esquema Drizzle e conexão (PostgreSQL / PGlite)
src/server/services/   regras de negócio + permissões (testadas)
src/server/pdf/        renderizador de PDF com a identidade da CasAfro
src/app/               telas (Next.js App Router) — só chamam serviços
drizzle/               migrações SQL (inclui gatilhos de proteção do histórico)
tests/                 m1…m8, um arquivo por módulo
scripts/               migração, criação do admin, backup
```
