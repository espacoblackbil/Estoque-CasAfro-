/**
 * Teste ponta a ponta no navegador (celular 390px), contra um app rodando com banco ZERADO
 * e o administrador principal "dona"/"senha123" já criado.
 *
 *   DATABASE_URL=... npm run build && npm run criar-admin -- "Dona CasAfro" dona senha123
 *   DATABASE_URL=... npx next start -p 3100 &
 *   BASE_URL=http://localhost:3100 node scripts/e2e.cjs [pasta-para-capturas]
 *
 * Requer o pacote "playwright" com Chromium instalado (não é dependência do projeto).
 */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");

const B = process.env.BASE_URL || "http://localhost:3100";
const OUT = process.argv[2];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  const errosJs = [];
  page.on("pageerror", (e) => errosJs.push(e.message));
  const shot = async (n) => OUT && page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true });
  const nbsp = (t) => (t || "").replace(/ /g, " ");
  /** Espera a mensagem da ação e falha se for erro. */
  const resultado = async (etapa) => {
    await page.waitForSelector(".aviso");
    const erro = await page.locator(".aviso.erro").first().textContent({ timeout: 500 }).catch(() => null);
    if (erro) throw new Error(`${etapa}: ${erro}`);
  };
  const etapa = (t) => console.log("✓", t);
  const entrar = async (login, senha) => {
    await page.goto(B + "/login");
    await page.fill("#login", login);
    await page.fill("#senha", senha);
    await page.click("button[type=submit]");
  };

  // ── Administrador: cadastros ──
  await entrar("dona", "senha123");
  await page.waitForURL(B + "/", { waitUntil: "commit" });
  await page.waitForSelector("text=Painel");
  etapa("login do administrador principal");

  for (const c of ["Cabelo", "Bebidas"]) {
    await page.goto(B + "/categorias");
    await page.fill("input[name=nome] >> nth=0", c);
    await page.click("text=Adicionar");
    await resultado("categoria");
  }
  await page.goto(B + "/fornecedores");
  await page.fill("form input[name=nome] >> nth=0", "Ayo Cosméticos");
  await page.fill("form input[name=documento] >> nth=0", "41.915.055/0001-09");
  await page.click("text=Cadastrar");
  await resultado("fornecedor");
  await page.goto(B + "/usuarios");
  await page.click("summary:has-text('Novo usuário')");
  await page.fill("form input[name=nome] >> nth=0", "Carla Colab");
  await page.fill("input[name=login] >> nth=0", "carla");
  await page.fill("input[name=senha] >> nth=0", "senha123");
  await page.selectOption("select[name=papel] >> nth=0", "colaborador");
  await page.click("text=Criar usuário");
  await resultado("usuário");
  etapa("categorias, fornecedor e colaboradora");

  const produto = async (nome, mod, preco, extra) => {
    await page.goto(B + "/produtos/novo");
    await page.fill("input[name=nome]", nome);
    await page.selectOption("select[name=categoriaId]", { label: "Cabelo" });
    await page.selectOption("select[name=modalidade]", mod);
    if (mod === "consignado") await page.selectOption("select[name=fornecedorId]", { label: "Ayo Cosméticos" });
    await page.fill("input[name=preco]", preco);
    for (const [k, v] of Object.entries(extra)) await page.fill(`input[name=${k}]`, v);
    await page.click("text=Cadastrar produto");
    await resultado("produto");
  };
  await produto("Óleo de Coco 120ml", "consignado", "50,00", { repasse: "30,00", comissao: "10" });
  await produto("Máscara Nutritiva 500g", "proprio", "60,00", { comissao: "5" });
  etapa("produtos próprio e consignado");

  const entrada = async (nome, qtd, custo) => {
    await page.goto(B + "/estoque");
    const sel = "details:has(summary:has-text('Entrada'))";
    const valor = await page.locator(`${sel} select[name=produtoId] option`, { hasText: nome }).getAttribute("value");
    await page.selectOption(`${sel} select[name=produtoId]`, valor);
    await page.fill(`${sel} input[name=quantidade]`, qtd);
    if (custo) await page.fill(`${sel} input[name=custo]`, custo);
    await page.click("text=Registrar entrada");
    await resultado("entrada");
  };
  await entrada("Óleo de Coco", "10");
  await entrada("Máscara Nutritiva", "10", "20,00");
  etapa("entradas de estoque");

  // ── Venda de hoje com desconto e pagamento dividido ──
  await page.goto(B + "/vender");
  await page.click("button.produto-btn:has-text('Óleo de Coco')");
  await page.click("button.produto-btn:has-text('Óleo de Coco')");
  await page.click("button.produto-btn:has-text('Máscara')");
  await page.selectOption("select >> nth=0", { label: "Carla Colab" });
  await page.fill("input[placeholder='0,00'] >> nth=0", "10,00");
  await page.fill("input[placeholder='0,00'] >> nth=1", "100,00");
  await page.click("button:has-text('restante') >> nth=1");
  await shot("01-pdv");
  await page.click("button:has-text('Concluir venda')");
  await page.waitForSelector(".aviso.ok");
  etapa("venda com desconto e pagamento dividido (Pix + dinheiro)");

  // ── Venda retroativa com valores da época ──
  await page.goto(B + "/vender");
  await page.click("button.produto-btn:has-text('Óleo de Coco')");
  await page.fill("input[type=date]", "2026-09-15");
  await page.fill("input[aria-label='Preço da época']", "45,00");
  await page.fill("input[aria-label='Custo ou repasse da época']", "28,00");
  await page.fill("input[aria-label='Comissão da época (%)']", "8");
  await page.click("button:has-text('restante') >> nth=0");
  await shot("02-pdv-retroativa");
  await page.click("button:has-text('Concluir venda')");
  await page.waitForSelector(".aviso.ok");
  await page.click("text=Ver venda");
  await page.waitForSelector("text=Itens");
  const detalhe = nbsp(await page.textContent("main"));
  assert.match(detalhe, /15\/09\/2026/);
  assert.match(detalhe, /R\$ 45,00/);
  assert.match(detalhe, /R\$ 28,00/); // repasse da época
  assert.match(detalhe, /R\$ 3,60/); // 8% de 45,00
  etapa("venda retroativa preserva preço, repasse e comissão da época");

  // ── Consumo interno de consignado ──
  await page.goto(B + "/estoque");
  await page.click("summary:has-text('Saída')");
  const sel = "details:has(summary:has-text('Saída'))";
  const oleo = await page.locator(`${sel} select[name=produtoId] option`, { hasText: "Óleo de Coco" }).getAttribute("value");
  await page.selectOption(`${sel} select[name=produtoId]`, oleo);
  await page.fill(`${sel} input[name=quantidade]`, "1");
  await page.click("text=Registrar saída");
  await resultado("consumo interno");
  etapa("consumo interno de consignado");

  // ── Painel e Financeiro ──
  await page.goto(B + "/");
  await shot("03-painel");
  await page.goto(B + "/financeiro?mes=2026-09");
  const fin = nbsp(await page.textContent("main"));
  assert.match(fin, /Receita líquida\s*R\$ 45,00/);
  assert.match(fin, /Ayo Cosméticos/);
  await shot("04-financeiro");
  etapa("tela Financeiro por período (setembro: receita R$ 45,00 e repasse ao fornecedor)");

  // ── Fechamento e PDF ──
  await page.goto(B + "/relatorios");
  await page.click("text=Gerar fechamento");
  await resultado("fechamento");
  const href = await page.locator("a:has-text('PDF')").first().getAttribute("href");
  const pdf = await page.request.get(B + href);
  assert.equal(pdf.status(), 200);
  assert.equal(pdf.headers()["content-type"], "application/pdf");
  etapa("fechamento mensal e download do PDF");

  // ── Colaboradora: acesso restrito ──
  await page.click("button:has-text('Sair')");
  await page.waitForURL(/login/, { waitUntil: "commit" });
  await entrar("carla", "senha123");
  await page.waitForSelector("text=Olá, Carla");
  await page.goto(B + "/produtos");
  assert.doesNotMatch(await page.content(), /repasse|custo/i);
  for (const rota of ["/estoque", "/financeiro", "/relatorios", "/auditoria", "/configuracoes", "/usuarios", "/menu"]) {
    await page.goto(B + rota);
    assert.equal(new URL(page.url()).pathname, "/", `colaboradora acessou ${rota}`);
  }
  assert.equal((await page.request.get(B + href)).status(), 403);
  etapa("colaboradora sem acesso a dados financeiros, telas administrativas e PDFs");

  // ── Bloqueio por tentativas ──
  await page.click("button:has-text('Sair')");
  await page.waitForURL(/login/, { waitUntil: "commit" });
  for (let i = 0; i < 5; i++) {
    await entrar("carla", "errada");
    await page.waitForSelector(".aviso.erro");
  }
  await entrar("carla", "senha123");
  await page.waitForSelector(".aviso.erro");
  assert.match(await page.textContent(".aviso.erro"), /Muitas tentativas/);
  etapa("login bloqueado após 5 senhas erradas");

  assert.deepEqual(errosJs, [], "erros de JavaScript na página");
  console.log("\nE2E concluído sem erros.");
  await browser.close();
})().catch((e) => {
  console.error("✗ FALHOU:", e.message);
  process.exit(1);
});
