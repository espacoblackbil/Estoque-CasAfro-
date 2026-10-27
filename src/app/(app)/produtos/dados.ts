import { campo, campoOpcional, dinheiro, idOuNulo, marcado, percentual } from "@/app/formularios";
import type { DadosProduto } from "@/server/services/cadastros";

export function produtoDoForm(fd: FormData): DadosProduto {
  return {
    nome: campo(fd, "nome"),
    categoriaId: idOuNulo(fd, "categoriaId"),
    fornecedorId: idOuNulo(fd, "fornecedorId"),
    modalidade: campo(fd, "modalidade") === "consignado" ? "consignado" : "proprio",
    precoVendaCents: dinheiro(fd, "preco"),
    custoCents: dinheiro(fd, "custo"),
    repasseCents: dinheiro(fd, "repasse"),
    comissaoBps: percentual(fd, "comissao"),
    ativo: marcado(fd, "ativo"),
  };
}

export const justificativaDoForm = (fd: FormData) => campoOpcional(fd, "justificativa");
