# CASAFRO GESTÃO

**Especificação funcional consolidada — Versão 1.0**

- **Empresa:** CasAfro — CNPJ 41.915.055/0001-09
- **Projeto:** Plataforma interna de gestão da CasAfro
- **Finalidade:** Controle de estoque, vendas, consignações, comissões, fornecedores e relatórios financeiros.
- **Plataforma:** Sistema web responsivo, acessível pelo navegador.
- **Status:** Requisitos funcionais consolidados. Arquitetura técnica definida em [`ARQUITETURA.md`](./ARQUITETURA.md).

> Este documento é o **contrato funcional** do sistema. Toda implementação deve ser rastreável a uma seção daqui
> (ver matriz em [`RASTREABILIDADE.md`](./RASTREABILIDADE.md)). Alterações de requisito exigem nova versão deste arquivo.

---

## 1. Objetivo do projeto

Desenvolver um sistema de gestão para a CasAfro que centralize o controle dos produtos comercializados ou utilizados no espaço.

O sistema deverá registrar automaticamente entradas e saídas, acompanhar vendas e comissões, calcular os valores devidos aos fornecedores consignados e produzir relatórios financeiros e operacionais confiáveis.

A principal finalidade é automatizar o fechamento mensal, eliminando a necessidade de conferir manualmente todas as movimentações e calcular os repasses de cada fornecedor.

O projeto deve priorizar simplicidade operacional, confiabilidade dos cálculos, segurança das informações e facilidade de uso pelo celular.

## 2. Identidade visual e experiência

A interface deverá apresentar:

- Design minimalista, moderno e profissional.
- Identidade visual baseada nas cores da CasAfro: verde pastel, rosa pastel e amarelo pastel.
- Navegação simples, organizada e intuitiva.
- Prioridade para uso em smartphones, com adaptação para computadores.
- Acesso pelo navegador, sem instalação obrigatória.
- Telas adequadas para registrar vendas rapidamente.
- Indicadores financeiros apresentados de maneira clara.

A marca gráfica e os códigos oficiais das cores poderão ser configurados posteriormente.

## 3. Perfis de usuários e permissões

### 3.1. Administrador principal

Terá acesso integral ao sistema e será responsável por gerenciar outros administradores.

Poderá realizar todas as operações administrativas, financeiras e operacionais.

### 3.2. Administradores

Poderão:

- Cadastrar e editar produtos, fornecedores e categorias.
- Registrar entradas, saídas, vendas e ajustes de estoque.
- Aplicar descontos.
- Consultar custos, resultados e repasses.
- Configurar comissões dos produtos.
- Cadastrar colaboradores.
- Registrar pagamentos de comissões.
- Emitir relatórios e consultar auditorias.
- Realizar correções de períodos anteriores.
- Autorizar vendas com margem negativa.

Não poderão criar ou administrar contas com privilégios de administrador principal.

### 3.3. Colaboradores

Poderão:

- Consultar produtos, preços e disponibilidade.
- Registrar vendas.
- Consultar o próprio histórico de vendas.
- Acompanhar comissões geradas, pagas e pendentes.

Não poderão acessar custos, lucros, comissões de outros colaboradores, valores de repasse ou relatórios financeiros administrativos.

Cada usuário terá login individual. O administrador cadastrará usuário e senha inicial, que poderá continuar sendo utilizada pelo colaborador.

Senhas nunca deverão ser armazenadas em texto simples.

## 4. Cadastro e organização dos produtos

Todos os produtos serão registrados em um único sistema de estoque.

Exemplos:

- Máscaras capilares.
- Shampoos, óleos, perfumes e finalizadores.
- Refrigerantes e outras bebidas.
- Balas, doces e demais mercadorias.

Cada produto deverá possuir:

- Nome.
- Categoria.
- Fornecedor.
- Modalidade: próprio ou consignado.
- Quantidade atual.
- Preço de venda.
- Preço de custo, quando próprio.
- Valor fixo de repasse, quando consignado.
- Percentual de comissão de venda.
- Histórico de entradas, saídas e alterações.
- Situação: ativo ou inativo.

O administrador poderá cadastrar e organizar livremente as categorias.

A quantidade mínima de estoque será uma configuração global, válida para todos os produtos.

Não haverá controle de validade nem necessidade de código de barras.

Cada produto pertencerá a uma única modalidade de estoque, sem mistura de mercadoria própria e consignada no mesmo registro.

## 5. Fornecedores e consignação

O cadastro de fornecedores conterá:

- Nome.
- CPF ou CNPJ.
- Telefone.

O sistema deverá distinguir duas modalidades:

**Produtos próprios:** mercadorias adquiridas pela CasAfro, cujo custo será calculado pelo custo médio ponderado das compras.

**Produtos consignados:** mercadorias disponibilizadas pelo fornecedor, com um valor fixo de repasse por unidade.

A diferença entre o preço efetivo de venda e o valor de repasse será a margem bruta da CasAfro antes das comissões e outras despesas.

O repasse será gerado quando um produto consignado for:

- Vendido.
- Utilizado internamente.
- Perdido.
- Danificado.
- Baixado por outra movimentação classificada como responsabilidade financeira da CasAfro.

Uma devolução de mercadoria não vendida ao fornecedor reduzirá o estoque sem gerar repasse.

O sistema deverá apenas apurar e informar o valor devido ao fornecedor, sem controlar se o pagamento já foi realizado.

## 6. Movimentações e controle de estoque

O sistema deverá registrar:

1. Entrada de mercadorias.
2. Venda.
3. Consumo interno.
4. Perda.
5. Dano.
6. Devolução ao fornecedor.
7. Ajuste de inventário.
8. Cancelamento ou devolução de venda.

Cada movimentação deverá preservar tipo, produto, quantidade, data efetiva, data de registro e usuário responsável.

Movimentações administrativas deverão permitir justificativas, obrigatórias em correções de estoque.

O consumo interno será registrado em unidades inteiras.

**Estoque negativo:** o sistema permitirá vender produtos sem saldo suficiente, mas deverá destacar essa condição e preservar a rastreabilidade.

**Divergências de inventário:** quando um produto consignado apresentar diferença entre o estoque físico e o registrado, o administrador deverá classificar a ocorrência antes da definição do repasse.

**Histórico retroativo:** será permitido lançar entradas, vendas e saídas de meses anteriores, utilizando preços, custos, repasses e comissões efetivamente praticados na época.

O sistema deverá permitir estabelecer um saldo inicial de implantação e reconciliar movimentações históricas, evitando duplicações de estoque.

## 7. Registro de vendas

Administradores e colaboradores poderão registrar vendas.

Cada venda poderá conter vários produtos, mas terá um único colaborador responsável.

O processo deverá permitir:

- Pesquisa e seleção dos produtos pelo nome.
- Definição das quantidades.
- Cálculo automático dos subtotais.
- Seleção do colaborador responsável.
- Nome opcional do cliente.
- Registro da forma de pagamento.
- Pagamentos divididos entre Pix, dinheiro, débito e crédito.
- Aplicação de descontos por produto e sobre o total, exclusivamente por administradores.

Descontos sobre o total da compra deverão ser distribuídos proporcionalmente entre os itens, preservando cálculos corretos de comissões e margens.

O valor total das formas de pagamento deverá corresponder ao valor final da venda.

Uma venda com margem negativa exigirá autorização de administrador. Se for iniciada por colaborador, não poderá ser concluída sem essa autorização.

O sistema não deverá descontar taxas de cartão.

## 8. Comissões dos colaboradores

A comissão será definida exclusivamente por produto.

Todos os colaboradores receberão o mesmo percentual quando venderem o mesmo produto.

Não existirão percentuais individuais por colaborador.

Quando um produto não possuir percentual definido, sua comissão será considerada zero.

Fórmula:

> **Comissão = valor líquido vendido do produto × percentual de comissão.**

O valor líquido deverá considerar os descontos aplicados.

Produtos retirados para uso interno, perdidos ou danificados não gerarão comissão de venda.

O sistema deverá apresentar:

- Comissões geradas.
- Comissões pagas.
- Saldo pendente.
- Histórico de pagamentos.
- Histórico de ajustes e estornos.

Pagamentos poderão ser parciais ou integrais.

Quando uma venda for cancelada, sua comissão será estornada.

Se a comissão já tiver sido paga, o sistema deverá gerar um ajuste negativo para compensação em comissões futuras, sem apagar ou alterar o histórico do pagamento anterior.

## 9. Custos e resultado financeiro

Para produtos próprios, será utilizado custo médio ponderado.

Para consignados, será utilizado o valor fixo de repasse registrado na movimentação.

O sistema deverá distinguir:

- Faturamento bruto.
- Descontos concedidos.
- Receita líquida de vendas.
- Custo das mercadorias próprias vendidas.
- Repasses de consignados vendidos.
- Comissões geradas.
- Custos de consumo interno.
- Custos de perdas e danos.
- Resultado estimado da operação com produtos.

Os custos de uso interno e perdas deverão reduzir o resultado estimado, sem duplicação de despesas.

O resultado não deverá ser apresentado como lucro líquido total do salão, pois não incluirá despesas gerais da empresa.

Quando ocorrer venda com estoque negativo, o sistema deverá manter um tratamento consistente de custo estimado ou pendente e registrar os ajustes necessários após regularização do estoque.

Os valores históricos das transações não poderão ser alterados silenciosamente por mudanças posteriores de preços ou percentuais.

## 10. Dashboard administrativo

A tela inicial administrativa deverá apresentar:

- Faturamento do dia.
- Faturamento do mês.
- Resultado estimado mensal.
- Produtos com estoque baixo.
- Ranking de produtos mais vendidos.
- Ranking de colaboradores por vendas.
- Atalho para registrar nova venda.

Os indicadores deverão ser calculados a partir de dados reais e atualizados do sistema.

## 11. Relatórios em PDF

O sistema deverá gerar relatórios por mês completo ou intervalo personalizado.

### 11.1. Relatório geral

Conterá:

- Dados e identificação da CasAfro.
- Período selecionado.
- Faturamento e resultado estimado.
- Quantidades e valores das vendas.
- Entradas e saídas do estoque.
- Consumo interno, perdas e danos.
- Produtos mais vendidos.
- Ranking de colaboradores.
- Comissões geradas, pagas e pendentes.
- Custos e valores do estoque.
- Valores apurados para fornecedores consignados.

### 11.2. Relatório individual de fornecedor

Será um documento de prestação de contas contendo:

- Nome, CNPJ e informações da CasAfro.
- Identificação do fornecedor.
- Período.
- Relação exclusivamente dos produtos e movimentações que geraram repasse.
- Datas das movimentações.
- Quantidades.
- Valor unitário de repasse.
- Valor total por produto.
- Total geral devido ao fornecedor.

O relatório deverá distinguir vendas, consumo interno e perdas ou danos quando gerarem repasse.

Não deverá incluir movimentações sem obrigação de pagamento ao fornecedor.

### 11.3. Relatório individual de colaborador

Conterá:

- Identificação do colaborador.
- Período analisado.
- Produtos e quantidades vendidos.
- Valores das vendas.
- Comissões por produto.
- Total gerado.
- Pagamentos realizados.
- Ajustes negativos.
- Saldo de comissões pendente.

### 11.4. Emissão e retificação

Todos os relatórios serão exportados exclusivamente em PDF, com aparência profissional e minimalista, utilizando o logotipo e as cores da CasAfro.

Os PDFs deverão conter data de emissão e identificação do período.

Caso uma movimentação anterior seja corrigida depois da emissão de um relatório, o sistema deverá gerar uma nova versão identificada como relatório retificado, preservando as versões anteriores e o histórico das alterações.

## 12. Fechamento mensal

Haverá uma Central de Relatórios destinada ao fechamento.

O administrador poderá escolher o mês ou intervalo e gerar:

- PDF geral da CasAfro.
- PDFs individuais de fornecedores.
- PDFs individuais de colaboradores.
- Resumo das comissões do período.

A existência de um fechamento não impedirá ajustes posteriores por administradores.

Esses ajustes deverão permanecer registrados e poderão originar novas versões dos relatórios.

Não haverá módulo de abertura e fechamento de caixa físico.

## 13. Auditoria e rastreabilidade

Qualquer alteração administrativa relevante deverá guardar:

- Usuário responsável.
- Data e hora.
- Informação anterior.
- Informação nova.
- Justificativa da alteração.

Cancelamentos, ajustes de inventário, alterações retroativas e mudanças financeiras deverão permanecer rastreáveis.

O histórico não poderá ser simplesmente apagado para ocultar modificações.

A mesma operação não poderá produzir vendas duplicadas ou movimentações financeiras incompletas em caso de falha de conexão.

## 14. Configurações administrativas

O sistema deverá permitir cadastrar:

- Nome fantasia da CasAfro.
- Razão social.
- CNPJ.
- Endereço.
- Telefone.
- Logotipo.
- Categorias.
- Estoque mínimo global.
- Usuários e permissões.

Os dados empresariais serão utilizados automaticamente nos relatórios.

## 15. Tecnologia e hospedagem

A aplicação deverá funcionar pelo navegador, priorizando o celular.

Inicialmente, deverá ser possível utilizar um endereço gratuito, com possibilidade de configuração de domínio próprio posteriormente.

O sistema deverá possuir banco de dados persistente, autenticação segura, permissões verificadas no servidor e mecanismos de backup.

A escolha definitiva das tecnologias, do serviço de hospedagem e do banco de dados deverá considerar custo, confiabilidade, segurança, facilidade de manutenção e possibilidade de crescimento.

A utilização de uma plataforma gratuita não poderá justificar armazenamento temporário ou perda de informações financeiras.

## 16. Funcionalidades fora do escopo inicial

Não serão necessárias nesta versão:

- Emissão de nota fiscal.
- Gestão de agendamentos e serviços de salão.
- Controle de caixa físico.
- Conciliação bancária.
- Controle de pagamentos realizados aos fornecedores.
- Exportação de relatórios em Excel.
- Controle de validade dos produtos.
- Aplicativo nativo para instalação.
- Leitura obrigatória de código de barras.
- Cálculo de taxas de cartão.

## 17. Critérios mínimos de funcionamento

Antes de considerar o sistema concluído, deverão ser testadas situações como:

1. Registrar venda com múltiplos produtos e pagamento dividido.
2. Aplicar descontos e calcular corretamente comissões e repasses.
3. Registrar consumo interno de consignado, gerando repasse sem faturamento.
4. Registrar perdas, danos e diferenças de inventário.
5. Vender com estoque negativo e regularizar posteriormente.
6. Cancelar venda cuja comissão já tenha sido paga.
7. Registrar movimentação retroativa preservando valores históricos.
8. Corrigir movimentação anterior e emitir relatório retificado.
9. Impedir que colaboradores acessem informações financeiras restritas.
10. Gerar PDFs cujos totais correspondam exatamente aos registros da base de dados.

O sistema somente deverá ser considerado funcional quando as operações estiverem conectadas a um banco de dados real e os cálculos forem consistentes.

---

**Resultado esperado:** uma plataforma interna de gestão que permita à CasAfro acompanhar sua movimentação de produtos diariamente e realizar o fechamento mensal com informações confiáveis, rastreáveis e documentos profissionais, reduzindo o trabalho administrativo e a possibilidade de erros financeiros.
