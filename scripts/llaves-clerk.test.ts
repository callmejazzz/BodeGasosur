/*
  La carga de llaves públicas: de dónde sale el emisor, qué llaves se aceptan y
  qué pasa al volver a cargar. El JWKS se simula; la base es la de pruebas.
*/

import { generateKeyPairSync, randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { URL_PRUEBAS } from "../pruebas/base-de-pruebas";
import { cargarJwk, cargarLlavesDeClerk, emisorDeLlavePublicable, motivoDeRechazo, type JwkRsa } from "./llaves-clerk";

let dueno: Client;
beforeAll(async () => {
  dueno = new Client({ connectionString: URL_PRUEBAS });
  await dueno.connect();
});
afterAll(() => dueno.end());
afterEach(() => vi.unstubAllGlobals());

const jwkNueva = (kid = `k-${randomUUID().slice(0, 8)}`): JwkRsa => ({
  ...(generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ format: "jwk" }) as JwkRsa),
  kid,
  alg: "RS256",
  use: "sig",
});

describe("llaves de Clerk", () => {
  it("el emisor sale de la llave publicable", () => {
    const pk = `pk_test_${Buffer.from("vocal-coyote-3344.clerk.accounts.dev$").toString("base64")}`;
    expect(emisorDeLlavePublicable(pk)).toBe("https://vocal-coyote-3344.clerk.accounts.dev");
    expect(emisorDeLlavePublicable(`pk_live_${Buffer.from("clerk.ejemplo.com$").toString("base64")}`)).toBe("https://clerk.ejemplo.com");
    expect(emisorDeLlavePublicable("sk_test_abc")).toBeNull();
    expect(emisorDeLlavePublicable(`pk_test_${Buffer.from("evil.com/x?$").toString("base64")}`)).toBeNull();
    expect(emisorDeLlavePublicable(undefined)).toBeNull();
  });

  it("solo acepta RSA de firma, RS256, de 2048 bits o más y exponente 65537", () => {
    const buena = jwkNueva();
    expect(motivoDeRechazo(buena)).toBeNull();
    expect(motivoDeRechazo({ ...buena, kty: "EC" })).toBe("no es RSA");
    expect(motivoDeRechazo({ ...buena, alg: "RS512" })).toBe("alg RS512");
    expect(motivoDeRechazo({ ...buena, use: "enc" })).toBe("use enc");
    expect(motivoDeRechazo({ ...buena, kid: undefined })).toBe("sin kid");
    expect(motivoDeRechazo({ ...buena, e: "Aw" })).toBe("exponente distinto de 65537");
    const corta = generateKeyPairSync("rsa", { modulusLength: 1024 }).publicKey.export({ format: "jwk" }) as JwkRsa;
    expect(motivoDeRechazo({ ...corta, kid: "corta" })).toBe("módulo menor de 2048 bits");
  });

  it("carga lo aceptable del JWKS, no duplica y no deja que un kid cambie de llave", async () => {
    const [a, b] = [jwkNueva(), jwkNueva()];
    const emisor = "https://clerk-carga.bodegasosur.test";
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ keys: [a, { ...b, kty: "EC" }] })));
    await expect(cargarLlavesDeClerk(URL_PRUEBAS, emisor)).resolves.toEqual([
      { kid: a.kid, estado: "cargada" },
      { kid: b.kid, estado: "rechazada: no es RSA" },
    ]);
    await expect(cargarLlavesDeClerk(URL_PRUEBAS, emisor)).resolves.toEqual([
      { kid: a.kid, estado: "sin-cambio" },
      { kid: b.kid, estado: "rechazada: no es RSA" },
    ]);
    await expect(cargarJwk(dueno, { ...jwkNueva(a.kid) }, emisor)).rejects.toThrow(/ya existe con otra llave/);
    await dueno.query("SELECT seguridad.desactivar_llave($1)", [a.kid]);
    await expect(cargarJwk(dueno, a, emisor)).resolves.toBe("reactivada");
  });
});
