import { campo, campoOpcional, dinheiro, idOuNulo, marcado, percentual } from "@/app/formularios";
import type { DadosProduto } from "@/server/services/cadastros";

export function produtoDoForm(fd: FormData): DadosProduto {
  const modalidade = campo(fd, "modalidade") === "consignado" ? "consignado" : "proprio";
  // Um único campo de valor: custo unitário (próprio) ou repasse por unidade (consignado).
  const valor = dinheiro(fd, "valor");
  return {
    nome: campo(fd, "nome"),
    categoriaId: idOuNulo(fd, "categoriaId"),
    fornecedorId: idOuNulo(fd, "fornecedorId"),
    modalidade,
    precoVendaCents: dinheiro(fd, "preco"),
    custoCents: modalidade === "proprio" ? valor : 0,
    repasseCents: modalidade === "consignado" ? valor : 0,
    comissaoBps: percentual(fd, "comissao"),
    ativo: marcado(fd, "ativo"),
  };
}

export const justificativaDoForm = (fd: FormData) => campoOpcional(fd, "justificativa");
