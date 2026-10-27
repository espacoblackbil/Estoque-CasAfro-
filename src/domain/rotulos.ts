export const ROTULO_TIPO: Record<string, string> = {
  saldo_inicial: "Saldo inicial",
  entrada: "Entrada",
  venda: "Venda",
  consumo_interno: "Consumo interno",
  perda: "Perda",
  dano: "Dano",
  devolucao_fornecedor: "Devolução ao fornecedor",
  ajuste_inventario: "Ajuste de inventário",
  devolucao_venda: "Devolução de venda",
};
export const ROTULO_CLASSIF: Record<string, string> = {
  perda: "perda",
  dano: "dano",
  consumo_interno: "consumo interno",
  devolucao_fornecedor: "devolução ao fornecedor",
  erro_registro: "erro de registro",
};
export function rotuloMovimento(tipo: string, classificacao?: string | null) {
  const base = ROTULO_TIPO[tipo] ?? tipo;
  return classificacao ? `${base} (${ROTULO_CLASSIF[classificacao] ?? classificacao})` : base;
}
