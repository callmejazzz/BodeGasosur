import "server-only";
import { kidsCargados } from "@/lib/db";

// Alerta anticipada de rotación: si el JWKS de Clerk publica un kid que la base
// no tiene, las escrituras empezarán a fallar en cuanto Clerk firme con él. Solo
// avisa; la carga es manual (npm run db:llaves-clerk).

const CADA = 30 * 60 * 1000;

type Jwk = { kid?: string; kty?: string; use?: string };

export async function revisarLlavesDeClerk(): Promise<void> {
  const cargadas = await kidsCargados();
  if (cargadas.length === 0) {
    console.error("[seguridad] no hay llaves públicas de Clerk cargadas: toda escritura fallará. Corre npm run db:llaves-clerk.");
    return;
  }
  for (const emisor of new Set(cargadas.map((l) => l.emisor))) {
    try {
      const respuesta = await fetch(`${emisor}/.well-known/jwks.json`, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
      const { keys = [] } = (await respuesta.json()) as { keys?: Jwk[] };
      const faltan = keys
        .filter((k) => k.kty === "RSA" && (k.use === undefined || k.use === "sig") && k.kid)
        .map((k) => k.kid!)
        .filter((kid) => !cargadas.some((c) => c.emisor === emisor && c.kid === kid));
      if (faltan.length > 0) {
        console.error(`[seguridad] kid en el JWKS de ${emisor} sin cargar: ${faltan.join(", ")}. Carga la llave con npm run db:llaves-clerk.`);
      }
    } catch (error) {
      console.warn(`[seguridad] no se pudo revisar el JWKS de ${emisor}:`, error);
    }
  }
}

/** Revisa al arrancar y cada media hora, sin detener el arranque del servidor. */
export function vigilarLlavesDeClerk(): void {
  const revisar = () => revisarLlavesDeClerk().catch((error) => console.warn("[seguridad] revisión de llaves fallida:", error));
  void revisar();
  setInterval(revisar, CADA).unref();
}
