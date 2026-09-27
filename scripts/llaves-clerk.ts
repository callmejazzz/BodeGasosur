// Las llaves públicas con las que la base verifica los tokens de Clerk.
//
// Lee el JWKS del emisor por HTTPS y registra cada llave con
// seguridad.cargar_llave(), conectado como el dueño del esquema: la llave es
// pública, pero si el usuario de ejecución pudiera cargarla, registraría una
// propia. La carga es manual a propósito; nada rota llaves solo.
//
// El emisor sale de NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, o de --emisor.
//
// Uso:  npm run db:llaves-clerk
//       npm run db:llaves-clerk -- --emisor https://clerk.ejemplo.com
//       npm run db:llaves-clerk -- --desactivar <kid>

import "dotenv/config";
import { Client } from "pg";
import { esEjecucionDirecta } from "../prisma/comun";

/** La plantilla JWT de Clerk y la audiencia que la base exige. */
export const AUDIENCIA = "bodegasosur-db";

export type JwkRsa = { kty?: string; alg?: string; use?: string; kid?: string; n?: string; e?: string };

/** El emisor codificado en la llave publicable de Clerk (pk_test_… / pk_live_…). */
export function emisorDeLlavePublicable(llave: string | undefined): string | null {
  const m = /^pk_(?:test|live)_(.+)$/.exec(llave ?? "");
  if (!m) return null;
  const host = Buffer.from(m[1], "base64").toString("utf8").replace(/\$$/, "");
  return /^[a-z0-9.-]+$/i.test(host) ? `https://${host}` : null;
}

/** Solo RSA de firma, RS256, de 2048 bits o más y exponente 65537. */
export function motivoDeRechazo(jwk: JwkRsa): string | null {
  if (jwk.kty !== "RSA") return "no es RSA";
  if (jwk.alg !== undefined && jwk.alg !== "RS256") return `alg ${jwk.alg}`;
  if (jwk.use !== undefined && jwk.use !== "sig") return `use ${jwk.use}`;
  if (!jwk.kid) return "sin kid";
  if (!jwk.n || Buffer.from(jwk.n, "base64url").length < 256) return "módulo menor de 2048 bits";
  if (jwk.e !== "AQAB") return "exponente distinto de 65537";
  return null;
}

/** Registra una llave; devuelve «cargada», «sin-cambio» o «reactivada». */
export async function cargarJwk(dueno: Client, jwk: JwkRsa, emisor: string, audiencia = AUDIENCIA): Promise<string> {
  const motivo = motivoDeRechazo(jwk);
  if (motivo) throw new Error(`La llave ${jwk.kid ?? "(sin kid)"} no se acepta: ${motivo}.`);
  const { rows } = await dueno.query<{ r: string }>("SELECT seguridad.cargar_llave($1, $2, $3, $4, $5) AS r", [
    jwk.kid,
    emisor,
    audiencia,
    Buffer.from(jwk.n!, "base64url"),
    Buffer.from(jwk.e!, "base64url"),
  ]);
  return rows[0].r;
}

export async function leerJwks(emisor: string): Promise<JwkRsa[]> {
  if (!/^https:\/\/[^/?#\s]+$/.test(emisor)) throw new Error(`Emisor inválido: ${emisor}`);
  const respuesta = await fetch(`${emisor}/.well-known/jwks.json`, { redirect: "error", signal: AbortSignal.timeout(10_000) });
  if (!respuesta.ok) throw new Error(`El JWKS de ${emisor} respondió ${respuesta.status}.`);
  const cuerpo = (await respuesta.json()) as { keys?: JwkRsa[] };
  if (!Array.isArray(cuerpo.keys)) throw new Error(`El JWKS de ${emisor} no trae llaves.`);
  return cuerpo.keys;
}

/** Carga todas las llaves aceptables del JWKS del emisor. No desactiva ninguna. */
export async function cargarLlavesDeClerk(urlDueno: string, emisor: string) {
  const llaves = await leerJwks(emisor);
  const dueno = new Client({ connectionString: urlDueno });
  await dueno.connect();
  try {
    const resultado: { kid: string; estado: string }[] = [];
    for (const jwk of llaves) {
      const motivo = motivoDeRechazo(jwk);
      resultado.push({ kid: jwk.kid ?? "(sin kid)", estado: motivo ? `rechazada: ${motivo}` : await cargarJwk(dueno, jwk, emisor) });
    }
    return resultado;
  } finally {
    await dueno.end();
  }
}

async function main() {
  const urlDueno = process.env.DATABASE_URL_MIGRACIONES;
  if (!urlDueno) throw new Error("Falta DATABASE_URL_MIGRACIONES: las llaves las carga el dueño del esquema.");

  const indiceDesactivar = process.argv.indexOf("--desactivar");
  if (indiceDesactivar > 0) {
    const kid = process.argv[indiceDesactivar + 1];
    if (!kid) throw new Error("Indica el kid a desactivar.");
    const dueno = new Client({ connectionString: urlDueno });
    await dueno.connect();
    try {
      const { rows } = await dueno.query<{ r: boolean | null }>("SELECT seguridad.desactivar_llave($1) AS r", [kid]);
      console.log(rows[0].r ? `✓ Llave ${kid} desactivada.` : `· La llave ${kid} no estaba activa.`);
    } finally {
      await dueno.end();
    }
    return;
  }

  const indiceEmisor = process.argv.indexOf("--emisor");
  const emisor = indiceEmisor > 0 ? process.argv[indiceEmisor + 1] : emisorDeLlavePublicable(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  if (!emisor) {
    console.log("· Carga de llaves omitida: falta NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY en .env (o --emisor).");
    return;
  }
  console.log(`Leyendo el JWKS de ${emisor}…`);
  for (const { kid, estado } of await cargarLlavesDeClerk(urlDueno, emisor)) console.log(`  ${kid}: ${estado}`);
}

if (esEjecucionDirecta(import.meta.url)) {
  main().catch((e) => {
    console.error(e instanceof Error ? `✗ ${e.message}` : e);
    process.exit(1);
  });
}
