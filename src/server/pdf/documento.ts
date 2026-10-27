/**
 * Renderizador de PDF minimalista com a identidade da CasAfro (spec §11.4).
 * Recebe um modelo de documento neutro (blocos) e devolve o PDF em Buffer.
 */
import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";

export const CORES = {
  verde: "#A8D5BA",
  verdeEscuro: "#2F6B4F",
  rosa: "#F4C2C9",
  amarelo: "#F7E39C",
  texto: "#1F2A24",
  suave: "#6B7280",
  linha: "#E5E7EB",
  zebra: "#FAFAF6",
  cabecalho: "#111111",
};

export type Alinhamento = "left" | "right" | "center";
export interface Coluna { titulo: string; largura: number; alinhar?: Alinhamento }

export type Bloco =
  | { tipo: "titulo"; texto: string }
  | { tipo: "kpis"; itens: { rotulo: string; valor: string; destaque?: boolean }[] }
  | { tipo: "tabela"; titulo?: string; colunas: Coluna[]; linhas: string[][]; total?: string[]; vazio?: string }
  | { tipo: "paragrafo"; texto: string; suave?: boolean }
  | { tipo: "aviso"; texto: string };

export interface ModeloDocumento {
  titulo: string;
  subtitulo?: string;
  periodo: string;
  emitidoEm: string;
  emitidoPor: string;
  versao: number;
  retificado: boolean;
  empresa: { nomeFantasia: string; razaoSocial: string; cnpj: string; endereco: string; telefone: string; logotipo: string };
  blocos: Bloco[];
}

const MARGEM = 40;

function carregarLogo(logotipo: string): Buffer | null {
  if (logotipo?.startsWith("data:image/")) {
    return Buffer.from(logotipo.slice(logotipo.indexOf(",") + 1), "base64");
  }
  const padrao = path.join(process.cwd(), "public", "logo-casafro-header.jpg");
  return fs.existsSync(padrao) ? fs.readFileSync(padrao) : null;
}

/** A fonte padrão do PDF (WinAnsi) não tem alguns símbolos Unicode; troca por equivalentes. */
const limpar = (t: string) => (t ?? "").replace(/\u2212/g, "-").replace(/[\u2192\u2190]/g, "-").replace(/\u00a0/g, " ");

function sanitizar(m: ModeloDocumento): ModeloDocumento {
  const blocos = m.blocos.map((b): Bloco => {
    switch (b.tipo) {
      case "titulo": case "paragrafo": case "aviso": return { ...b, texto: limpar(b.texto) };
      case "kpis": return { ...b, itens: b.itens.map((k) => ({ ...k, rotulo: limpar(k.rotulo), valor: limpar(k.valor) })) };
      case "tabela": return {
        ...b,
        titulo: b.titulo && limpar(b.titulo),
        colunas: b.colunas.map((c) => ({ ...c, titulo: limpar(c.titulo) })),
        linhas: b.linhas.map((l) => l.map(limpar)),
        total: b.total?.map(limpar),
      };
    }
  });
  return { ...m, titulo: limpar(m.titulo), subtitulo: m.subtitulo && limpar(m.subtitulo), blocos };
}

export function renderizarPdf(modelo: ModeloDocumento): Promise<Buffer> {
  const m = sanitizar(modelo);
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: MARGEM, bottom: MARGEM + 20, left: MARGEM, right: MARGEM },
    bufferPages: true,
    info: { Title: `${m.titulo} — ${m.periodo}`, Author: m.empresa.nomeFantasia, Creator: "CasAfro Gestão" },
  });
  const partes: Buffer[] = [];
  doc.on("data", (b: Buffer) => partes.push(b));
  const pronto = new Promise<Buffer>((res, rej) => {
    doc.on("end", () => res(Buffer.concat(partes)));
    doc.on("error", rej);
  });

  const largura = doc.page.width - MARGEM * 2;
  const limiteY = () => doc.page.height - MARGEM - 24;

  // ── Cabeçalho ──
  const alturaCab = 92;
  doc.rect(0, 0, doc.page.width, alturaCab).fill(CORES.cabecalho);
  const logo = carregarLogo(m.empresa.logotipo);
  if (logo) {
    try {
      doc.image(logo, MARGEM - 6, 10, { fit: [150, 72], valign: "center" });
    } catch {
      doc.fillColor(CORES.amarelo).font("Helvetica-Bold").fontSize(22).text(m.empresa.nomeFantasia, MARGEM, 34);
    }
  } else {
    doc.fillColor(CORES.amarelo).font("Helvetica-Bold").fontSize(22).text(m.empresa.nomeFantasia, MARGEM, 34);
  }
  const infos = [
    m.empresa.razaoSocial || m.empresa.nomeFantasia,
    m.empresa.cnpj ? `CNPJ ${m.empresa.cnpj}` : "",
    m.empresa.endereco,
    m.empresa.telefone,
  ].filter(Boolean);
  doc.font("Helvetica").fontSize(8.5).fillColor("#F3F4F6");
  doc.text(infos.join("\n"), MARGEM + 200, 22, { width: largura - 200, align: "right", lineGap: 1.5 });
  const faixa = alturaCab;
  doc.rect(0, faixa, doc.page.width, 4).fill(CORES.verde);
  doc.rect(0, faixa + 4, doc.page.width, 4).fill(CORES.rosa);
  doc.rect(0, faixa + 8, doc.page.width, 4).fill(CORES.amarelo);

  // ── Título ──
  doc.y = faixa + 30;
  doc.x = MARGEM;
  doc.fillColor(CORES.texto).font("Helvetica-Bold").fontSize(18).text(m.titulo, MARGEM, doc.y, { width: largura });
  if (m.subtitulo) doc.font("Helvetica").fontSize(11).fillColor(CORES.texto).text(m.subtitulo, { width: largura });
  doc.moveDown(0.2);
  doc.font("Helvetica").fontSize(9).fillColor(CORES.suave)
    .text(`Período: ${m.periodo}   ·   Emitido em ${m.emitidoEm} por ${m.emitidoPor}   ·   Versão ${m.versao}`, { width: largura });
  if (m.retificado) {
    doc.moveDown(0.4);
    const y = doc.y;
    doc.roundedRect(MARGEM, y, largura, 22, 4).fill(CORES.rosa);
    doc.fillColor(CORES.texto).font("Helvetica-Bold").fontSize(9.5)
      .text(`RELATÓRIO RETIFICADO — versão ${m.versao}. Substitui as versões anteriores, que permanecem arquivadas.`, MARGEM + 10, y + 6.5, { width: largura - 20 });
    doc.y = y + 22;
  }
  doc.moveDown(1);

  const garantirEspaco = (h: number) => {
    if (doc.y + h > limiteY()) {
      doc.addPage();
      doc.y = MARGEM;
    }
  };

  const tituloSecao = (t: string) => {
    garantirEspaco(50);
    doc.moveDown(0.6);
    const y = doc.y;
    doc.rect(MARGEM, y + 2, 3, 12).fill(CORES.verdeEscuro);
    doc.fillColor(CORES.texto).font("Helvetica-Bold").fontSize(11.5).text(t, MARGEM + 10, y, { width: largura - 10 });
    doc.moveDown(0.4);
    doc.x = MARGEM;
  };

  for (const b of m.blocos) {
    if (b.tipo === "titulo") tituloSecao(b.texto);
    else if (b.tipo === "paragrafo") {
      garantirEspaco(30);
      doc.font("Helvetica").fontSize(9).fillColor(b.suave ? CORES.suave : CORES.texto).text(b.texto, MARGEM, doc.y, { width: largura, lineGap: 2 });
      doc.moveDown(0.5);
    } else if (b.tipo === "aviso") {
      doc.font("Helvetica").fontSize(9);
      const h = doc.heightOfString(b.texto, { width: largura - 20 }) + 12;
      garantirEspaco(h + 6);
      const y = doc.y;
      doc.roundedRect(MARGEM, y, largura, h, 4).fill(CORES.amarelo);
      doc.fillColor(CORES.texto).text(b.texto, MARGEM + 10, y + 6, { width: largura - 20 });
      doc.y = y + h + 6;
      doc.x = MARGEM;
    } else if (b.tipo === "kpis") {
      const porLinha = 3;
      const gap = 8;
      const w = (largura - gap * (porLinha - 1)) / porLinha;
      const h = 46;
      for (let i = 0; i < b.itens.length; i += porLinha) {
        garantirEspaco(h + gap);
        const y = doc.y;
        b.itens.slice(i, i + porLinha).forEach((k, j) => {
          const x = MARGEM + j * (w + gap);
          doc.roundedRect(x, y, w, h, 5).fill(k.destaque ? CORES.verde : "#F4F6F3");
          doc.fillColor(CORES.suave).font("Helvetica").fontSize(7.8).text(k.rotulo.toUpperCase(), x + 9, y + 8, { width: w - 18 });
          doc.fillColor(CORES.texto).font("Helvetica-Bold").fontSize(12.5).text(k.valor, x + 9, y + 22, { width: w - 18 });
        });
        doc.y = y + h + gap;
      }
      doc.x = MARGEM;
    } else if (b.tipo === "tabela") {
      if (b.titulo) tituloSecao(b.titulo);
      const soma = b.colunas.reduce((a, c) => a + c.largura, 0);
      const larguras = b.colunas.map((c) => (c.largura / soma) * largura);
      const linhaTabela = (cells: string[], estilo: "cab" | "normal" | "zebra" | "total") => {
        doc.font(estilo === "cab" || estilo === "total" ? "Helvetica-Bold" : "Helvetica").fontSize(estilo === "cab" ? 8 : 8.6);
        const h = Math.max(...cells.map((t, i) => doc.heightOfString(t ?? "", { width: larguras[i] - 10 }))) + 9;
        if (doc.y + h > limiteY()) {
          doc.addPage();
          doc.y = MARGEM;
          if (estilo !== "cab") linhaTabela(b.colunas.map((c) => c.titulo), "cab");
        }
        const y = doc.y;
        const fundo = estilo === "cab" ? CORES.verde : estilo === "total" ? CORES.amarelo : estilo === "zebra" ? CORES.zebra : null;
        if (fundo) doc.rect(MARGEM, y, largura, h).fill(fundo);
        let x = MARGEM;
        cells.forEach((t, i) => {
          doc.fillColor(CORES.texto)
            .font(estilo === "cab" || estilo === "total" ? "Helvetica-Bold" : "Helvetica")
            .fontSize(estilo === "cab" ? 8 : 8.6)
            .text(t ?? "", x + 5, y + 4.5, { width: larguras[i] - 10, align: b.colunas[i].alinhar ?? "left" });
          x += larguras[i];
        });
        doc.moveTo(MARGEM, y + h).lineTo(MARGEM + largura, y + h).lineWidth(0.5).strokeColor(CORES.linha).stroke();
        doc.y = y + h;
      };
      garantirEspaco(40);
      linhaTabela(b.colunas.map((c) => c.titulo), "cab");
      if (!b.linhas.length) {
        doc.font("Helvetica-Oblique").fontSize(8.6).fillColor(CORES.suave).text(b.vazio ?? "Sem registros no período.", MARGEM + 5, doc.y + 5, { width: largura - 10 });
        doc.moveDown(0.5);
      }
      b.linhas.forEach((l, i) => linhaTabela(l, i % 2 ? "zebra" : "normal"));
      if (b.total) linhaTabela(b.total, "total");
      doc.moveDown(0.6);
      doc.x = MARGEM;
    }
  }

  // ── Rodapé com paginação ──
  const faixaPaginas = doc.bufferedPageRange();
  for (let i = 0; i < faixaPaginas.count; i++) {
    doc.switchToPage(faixaPaginas.start + i);
    doc.page.margins.bottom = 0; // permite escrever no rodapé sem criar página nova
    const y = doc.page.height - MARGEM;
    doc.rect(MARGEM, y - 6, largura, 0.6).fill(CORES.linha);
    doc.font("Helvetica").fontSize(7.5).fillColor(CORES.suave)
      .text(`${m.empresa.nomeFantasia} · ${m.titulo} · ${m.periodo} · v${m.versao}${m.retificado ? " (retificado)" : ""} · Emitido em ${m.emitidoEm}`, MARGEM, y, { width: largura - 80, lineBreak: false })
      .text(`Página ${i + 1} de ${faixaPaginas.count}`, MARGEM + largura - 80, y, { width: 80, align: "right", lineBreak: false });
  }
  doc.end();
  return pronto;
}
