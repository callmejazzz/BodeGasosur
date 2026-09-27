/*
  La alerta anticipada de rotación: compara el JWKS de Clerk con las llaves que
  la base tiene cargadas y solo avisa. El JWKS se simula; las llaves son las
  de la base de pruebas.
*/

import { afterEach, describe, expect, inject, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: null, getToken: async () => null }) }));

process.env.DATABASE_URL = inject("urlEjecucionPruebas");
const { revisarLlavesDeClerk } = await import("./llaves");

const llave = inject("llavePruebas");

function jwksCon(...kids: string[]) {
  return vi.fn(async (url: string | URL) => {
    expect(String(url)).toBe(`${llave.emisor}/.well-known/jwks.json`);
    return Response.json({ keys: kids.map((kid) => ({ kid, kty: "RSA", use: "sig", alg: "RS256", n: "AQAB", e: "AQAB" })) });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("alerta de llaves de Clerk", () => {
  it("callada cuando el JWKS solo trae llaves cargadas", async () => {
    vi.stubGlobal("fetch", jwksCon(llave.kid));
    const errores = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await revisarLlavesDeClerk();
    expect(errores).not.toHaveBeenCalled();
  });

  it("avisa, con su propia línea, cuando el JWKS publica un kid sin cargar", async () => {
    vi.stubGlobal("fetch", jwksCon(llave.kid, "ins_rotada"));
    const errores = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await revisarLlavesDeClerk();
    expect(errores).toHaveBeenCalledWith(expect.stringMatching(/^\[seguridad\] kid en el JWKS de .+ sin cargar: ins_rotada\./));
  });

  it("si el JWKS no responde, advierte sin detener nada", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 503 })));
    const avisos = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(revisarLlavesDeClerk()).resolves.toBeUndefined();
    expect(avisos).toHaveBeenCalledWith(expect.stringContaining("[seguridad] no se pudo revisar el JWKS"), expect.any(Error));
  });
});
