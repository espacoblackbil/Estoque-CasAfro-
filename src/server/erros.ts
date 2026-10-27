/** Erro de regra de negócio: mensagem segura para exibir ao usuário. */
export class ErroNegocio extends Error {
  constructor(message: string, public codigo: string = "regra") {
    super(message);
    this.name = "ErroNegocio";
  }
}

export class ErroPermissao extends ErroNegocio {
  constructor(message = "Você não tem permissão para esta operação.") {
    super(message, "permissao");
    this.name = "ErroPermissao";
  }
}

export function exigir(condicao: unknown, mensagem: string): asserts condicao {
  if (!condicao) throw new ErroNegocio(mensagem);
}
