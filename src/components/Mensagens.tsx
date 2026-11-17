export function Mensagens({ ok, erro }: { ok?: string; erro?: string }) {
  return (
    <>
      {ok && <div className="aviso ok" role="status">{ok}</div>}
      {erro && <div className="aviso erro" role="alert">{erro}</div>}
    </>
  );
}

export type BuscaParams = Promise<Record<string, string | string[] | undefined>>;

export async function lerParams(sp: BuscaParams) {
  const p = await sp;
  const s = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : undefined);
  return { s, ok: s("ok"), erro: s("erro") };
}
