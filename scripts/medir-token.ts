// Mide lo que cuesta pedir el token de la plantilla bodegasosur-db, como lo
// hace accionProtegida() en cada escritura (POST /sessions/{id}/tokens/{plantilla}),
// y confirma que cada llamada trae un jti nuevo. Nunca imprime un token.
//
// Necesita el id de una sesión activa. Con la sesión abierta en la aplicación,
// en la consola del navegador:  window.Clerk.session.id
//
// Uso:  npm run clerk:medir-token -- <sess_…> [veces]

import "dotenv/config";
import { createClerkClient } from "@clerk/backend";

const PLANTILLA = "bodegasosur-db";

function percentil(valores: number[], p: number): number {
  const orden = [...valores].sort((a, b) => a - b);
  return orden[Math.min(orden.length - 1, Math.ceil((p / 100) * orden.length) - 1)];
}

async function main() {
  const sesion = process.argv[2];
  const veces = Number(process.argv[3] ?? 20);
  if (!sesion?.startsWith("sess_")) throw new Error("Indica el id de una sesión activa (sess_…).");
  if (!Number.isInteger(veces) || veces < 2 || veces > 100) throw new Error("Las veces van de 2 a 100.");
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error("Falta CLERK_SECRET_KEY.");

  const clerk = createClerkClient({ secretKey });
  const tiempos: number[] = [];
  const jtis = new Set<string>();
  let vida = 0;
  for (let i = 0; i < veces; i++) {
    const inicio = performance.now();
    const { jwt } = await clerk.sessions.getToken(sesion, PLANTILLA);
    tiempos.push(performance.now() - inicio);
    const carga = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8")) as { jti: string; exp: number; iat: number; aud?: unknown };
    jtis.add(carga.jti);
    vida = carga.exp - carga.iat;
    if (carga.aud !== "bodegasosur-db") throw new Error(`La plantilla no trae aud = "bodegasosur-db" (trae ${JSON.stringify(carga.aud)}).`);
  }

  const ms = (n: number) => `${n.toFixed(0)} ms`;
  console.log(`getToken("${PLANTILLA}") × ${veces}`);
  console.log(`  p50 ${ms(percentil(tiempos, 50))} · p95 ${ms(percentil(tiempos, 95))} · máx ${ms(Math.max(...tiempos))}`);
  console.log(`  jti distintos: ${jtis.size} de ${veces}${jtis.size === veces ? " ✓" : " ✗ — Clerk repite tokens: la segunda escritura se rechazaría"}`);
  console.log(`  vida del token: ${vida} s`);
}

main().catch((e) => {
  console.error(e instanceof Error ? `✗ ${e.message}` : e);
  process.exit(1);
});
