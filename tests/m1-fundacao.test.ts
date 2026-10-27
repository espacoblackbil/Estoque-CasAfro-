import { describe, it, expect, beforeAll } from "vitest";
import { sql } from "drizzle-orm";
import { novoCenario, type Cenario } from "./helpers";
import { aplicarBps, arred, parseBRL, ratear, parsePercentual } from "@/domain/money";
import { intervaloDoMes } from "@/domain/datas";
import {
  atorDaSessao, autorizacaoAdmin, criarPrincipalInicial, criarUsuario, editarUsuario, entrar, sair, listarUsuarios,
} from "@/server/services/usuarios";
import { listarAuditoria } from "@/server/services/auditoria";
import { obterConfiguracoes, salvarConfiguracoes } from "@/server/services/configuracoes";
import { usuarios, auditoria } from "@/server/db/schema";

describe("M1 · dinheiro e datas", () => {
  it("arredonda meio para cima e simétrico", () => {
    expect(arred(5, 2)).toBe(3);
    expect(arred(-5, 2)).toBe(-3);
    expect(aplicarBps(1999, 1000)).toBe(200); // 10% de 19,99 = 1,999 → 2,00
    expect(aplicarBps(1234, 750)).toBe(93); // 7,5% de 12,34 = 0,9255 → 0,93
  });
  it("rateio fecha exatamente no total", () => {
    const partes = ratear(1000, [3333, 3333, 3334]);
    expect(partes.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(ratear(1, [1, 1, 1])).toEqual([1, 0, 0]);
    expect(ratear(500, [1000, 3000])).toEqual([125, 375]);
  });
  it("interpreta valores em reais e percentuais", () => {
    expect(parseBRL("12,50")).toBe(1250);
    expect(parseBRL("R$ 1.234,56")).toBe(123456);
    expect(parseBRL("7.5")).toBe(750);
    expect(() => parseBRL("1,234")).toThrow();
    expect(parsePercentual("10,5")).toBe(1050);
    expect(intervaloDoMes("2026-02")).toEqual(["2026-02-01", "2026-02-28"]);
  });
});

describe("M1 · autenticação, perfis e auditoria", () => {
  let c: Cenario;
  beforeAll(async () => { c = await novoCenario(); });

  it("não guarda senha em texto simples", async () => {
    const linhas = await c.db.select().from(usuarios);
    for (const u of linhas) {
      expect(u.senhaHash).not.toContain("senha123");
      expect(u.senhaHash).toMatch(/^\$2[aby]\$/);
    }
  });

  it("login cria sessão; logout invalida", async () => {
    await expect(entrar(c.db, "carla", "errada")).rejects.toThrow("incorretos");
    const s = await entrar(c.db, "CARLA", "senha123");
    expect((await atorDaSessao(c.db, s.token))?.papel).toBe("colaborador");
    await sair(c.db, s.token);
    expect(await atorDaSessao(c.db, s.token)).toBeNull();
  });

  it("só é possível criar o principal uma vez", async () => {
    await expect(criarPrincipalInicial(c.db, { nome: "Outra", login: "outra", senha: "senha123" })).rejects.toThrow("já foi configurado");
  });

  it("admin não cria nem administra admins/principal; colaborador não cria ninguém", async () => {
    await expect(criarUsuario(c.db, c.admin, { nome: "X", login: "x1", senha: "senha123", papel: "admin" })).rejects.toThrow();
    await expect(criarUsuario(c.db, c.admin, { nome: "X", login: "x2", senha: "senha123", papel: "principal" })).rejects.toThrow();
    await expect(criarUsuario(c.db, c.colab, { nome: "X", login: "x3", senha: "senha123", papel: "colaborador" })).rejects.toThrow();
    await expect(editarUsuario(c.db, c.admin, c.principal.id, { ativo: false })).rejects.toThrow();
    const novo = await criarUsuario(c.db, c.admin, { nome: "Nova Colab", login: "nova", senha: "senha123", papel: "colaborador" });
    await expect(editarUsuario(c.db, c.admin, novo.id, { papel: "admin" })).rejects.toThrow();
    await editarUsuario(c.db, c.admin, novo.id, { ativo: false }, "desligada");
    await expect(entrar(c.db, "nova", "senha123")).rejects.toThrow();
  });

  it("principal gerencia admins; logins duplicados são recusados", async () => {
    const adm = await criarUsuario(c.db, c.principal, { nome: "Adm 2", login: "adm2", senha: "senha123", papel: "admin" });
    await editarUsuario(c.db, c.principal, adm.id, { papel: "colaborador" });
    await expect(criarUsuario(c.db, c.principal, { nome: "Dup", login: "ADM2", senha: "senha123", papel: "admin" })).rejects.toThrow("Já existe");
  });

  it("colaborador vê só a si mesmo na lista de usuários", async () => {
    const lista = await listarUsuarios(c.db, c.colab);
    expect(lista.map((u) => u.id)).toEqual([c.colab.id]);
  });

  it("autorização de admin por senha", async () => {
    expect((await autorizacaoAdmin(c.db, "admin", "senha123")).id).toBe(c.admin.id);
    await expect(autorizacaoAdmin(c.db, "carla", "senha123")).rejects.toThrow();
  });

  it("configurações com auditoria; colaborador não altera", async () => {
    const cfg = await obterConfiguracoes(c.db);
    expect(cfg.cnpj).toBe("41.915.055/0001-09");
    await expect(salvarConfiguracoes(c.db, c.colab, { ...cfg, estoqueMinimo: 9 })).rejects.toThrow();
    await salvarConfiguracoes(c.db, c.admin, { ...cfg, estoqueMinimo: 5, razaoSocial: "CasAfro LTDA" });
    expect((await obterConfiguracoes(c.db)).estoqueMinimo).toBe(5);
    const log = await listarAuditoria(c.db, c.admin, { entidade: "configuracoes" });
    expect(log[0].antes).toMatchObject({ estoqueMinimo: 3 });
    expect(log[0].depois).toMatchObject({ estoqueMinimo: 5 });
    await expect(listarAuditoria(c.db, c.colab)).rejects.toThrow();
  });

  it("auditoria é imutável no banco", async () => {
    await expect(c.db.execute(sql`delete from auditoria`)).rejects.toThrow();
    await expect(c.db.update(auditoria).set({ acao: "x" })).rejects.toThrow();
    await expect(c.db.execute(sql`delete from usuarios where login = 'carla'`)).rejects.toThrow();
  });
});
