import { parseBRL, parsePercentual } from "@/domain/money";

/** Leitura tipada de campos de formulário. */
export const campo = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
export const campoOpcional = (fd: FormData, k: string) => campo(fd, k) || undefined;
export const inteiro = (fd: FormData, k: string) => {
  const t = campo(fd, k);
  if (!/^-?\d+$/.test(t)) throw new Error(`Valor inválido em "${k}"`);
  return parseInt(t, 10);
};
export const inteiroOpcional = (fd: FormData, k: string) => (campo(fd, k) ? inteiro(fd, k) : undefined);
export const idOuNulo = (fd: FormData, k: string) => (campo(fd, k) ? inteiro(fd, k) : null);
export const dinheiro = (fd: FormData, k: string) => parseBRL(campo(fd, k) || "0");
export const dinheiroOpcional = (fd: FormData, k: string) => (campo(fd, k) ? parseBRL(campo(fd, k)) : undefined);
export const percentual = (fd: FormData, k: string) => parsePercentual(campo(fd, k));
export const marcado = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true";
