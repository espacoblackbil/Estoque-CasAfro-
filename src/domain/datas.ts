const FUSO = "America/Sao_Paulo";

/** Data de hoje (YYYY-MM-DD) no fuso de São Paulo. */
export function hoje(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}

export function validarData(d: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d + "T00:00:00Z"))) {
    throw new Error(`Data inválida: ${d}`);
  }
  return d;
}

/** Primeiro e último dia do mês ("2026-10" → ["2026-10-01","2026-10-31"]). */
export function intervaloDoMes(anoMes: string): [string, string] {
  const [a, m] = anoMes.split("-").map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return [`${a}-${mm}-01`, `${a}-${mm}-${String(ultimo).padStart(2, "0")}`];
}

export function formatarData(d: string): string {
  const [a, m, dia] = d.split("-");
  return `${dia}/${m}/${a}`;
}

export function formatarDataHora(dt: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, dateStyle: "short", timeStyle: "short" }).format(dt);
}
