/**
 * Dinheiro sempre em centavos inteiros; percentuais em pontos-base (1% = 100 bps).
 * Arredondamento: meio para cima (half-up) sobre valores não negativos;
 * para negativos, simétrico (o módulo é arredondado e o sinal reaplicado).
 */

export function arred(numerador: number, denominador: number): number {
  if (denominador === 0) return 0;
  const sinal = Math.sign(numerador) * Math.sign(denominador);
  const n = Math.abs(numerador);
  const d = Math.abs(denominador);
  return sinal * Math.floor((2 * n + d) / (2 * d));
}

/** valor × bps / 10000, arredondado. */
export function aplicarBps(cents: number, bps: number): number {
  return arred(cents * bps, 10000);
}

/**
 * Distribui `total` proporcionalmente aos `pesos` (maiores restos),
 * garantindo que a soma das partes seja exatamente `total`.
 */
export function ratear(total: number, pesos: number[]): number[] {
  const somaPesos = pesos.reduce((a, b) => a + b, 0);
  if (pesos.length === 0) return [];
  if (somaPesos === 0) {
    // sem base proporcional: tudo no primeiro item (caso degenerado)
    return pesos.map((_, i) => (i === 0 ? total : 0));
  }
  const brutos = pesos.map((p) => (total * p) / somaPesos);
  const partes = brutos.map((v) => Math.floor(v));
  let resto = total - partes.reduce((a, b) => a + b, 0);
  const ordem = brutos
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; resto > 0; k = (k + 1) % ordem.length, resto--) partes[ordem[k].i]++;
  return partes;
}

export function formatarBRL(cents: number): string {
  if (cents === 0) cents = 0; // evita "-R$ 0,00" para -0
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** "12,50" | "12.50" | "1.234,56" | "R$ 3" → centavos. Lança erro se inválido. */
export function parseBRL(texto: string): number {
  const limpo = texto.replace(/R\$|\s/g, "");
  if (!/^-?[\d.,]+$/.test(limpo)) throw new Error(`Valor inválido: "${texto}"`);
  let normal = limpo;
  if (limpo.includes(",")) normal = limpo.replace(/\./g, "").replace(",", ".");
  const [inteiro, frac = ""] = normal.split(".");
  if (frac.length > 2) throw new Error(`Valor com mais de 2 casas decimais: "${texto}"`);
  const sinal = inteiro.startsWith("-") ? -1 : 1;
  return sinal * (Math.abs(parseInt(inteiro || "0", 10)) * 100 + parseInt((frac + "00").slice(0, 2), 10));
}

/** "10" | "10,5" | "7.25" (%) → bps. */
export function parsePercentual(texto: string): number {
  const t = texto.replace("%", "").trim().replace(",", ".");
  if (t === "") return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) throw new Error(`Percentual inválido: "${texto}"`);
  const bps = Math.round(parseFloat(t) * 100);
  if (bps > 10000) throw new Error("Percentual acima de 100%");
  return bps;
}

export function formatarPercentual(bps: number): string {
  return `${(bps / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}
