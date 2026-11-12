/** Sustituto de Resend que respeta su idempotencia */
import { createHash, randomUUID } from "node:crypto";
import { clasificarRespuesta, type CorreoDelLote, type EnviadorDeLotes } from "../src/lib/correo/resend";

export type ErrorSimulado = { statusCode: number | null; name: string; message?: string };

export type OpcionesDelSimulado = {
  demoraMs?: number;
  aMitad?: (correos: CorreoDelLote[], llave: string, ids: string[]) => Promise<void>;
  errorPara?: (llave: string) => ErrorSimulado | undefined;
  perderRespuesta?: (llave: string) => boolean;
};

export type Peticion = { llave: string; huella: string; correos: CorreoDelLote[] };

const esperar = (ms: number, signal: AbortSignal) =>
  new Promise<boolean>((resolver) => {
    if (signal.aborted) return resolver(false);
    const temporizador = setTimeout(() => resolver(true), ms);
    signal.addEventListener("abort", () => (clearTimeout(temporizador), resolver(false)), { once: true });
  });

export function resendSimulado(o: OpcionesDelSimulado = {}) {
  const aceptados = new Map<string, { huella: string; ids: string[] }>();
  const enCurso = new Set<string>();
  const peticiones: Peticion[] = [];

  const enviar: EnviadorDeLotes = async (correos, { llave, signal }) => {
    const huella = createHash("sha256").update(JSON.stringify(correos)).digest("hex");
    peticiones.push({ llave, huella, correos });
    if (enCurso.has(llave)) return clasificarRespuesta(null, { statusCode: 409, name: "concurrent_idempotent_requests" });
    const previo = aceptados.get(llave);
    if (previo) {
      return previo.huella === huella ? { tipo: "aceptado", ids: previo.ids } : clasificarRespuesta(null, { statusCode: 409, name: "invalid_idempotent_request" });
    }
    enCurso.add(llave);
    try {
      const ids = correos.map(() => `re_${randomUUID()}`);
      const error = o.errorPara?.(llave);
      if (!error) aceptados.set(llave, { huella, ids });
      await o.aMitad?.(correos, llave, ids);
      if (error) return clasificarRespuesta(null, error);
      // El SDK devuelve sin estado una llamada abortada
      if (o.demoraMs && !(await esperar(o.demoraMs, signal))) return clasificarRespuesta(null, { statusCode: null, name: "application_error" });
      if (o.perderRespuesta?.(llave)) throw new Error("Se perdió la respuesta después de que Resend aceptó el lote");
      return { tipo: "aceptado", ids };
    } finally {
      enCurso.delete(llave);
    }
  };

  /** Cuántas peticiones recibió cada llave */
  const porLlave = () => Object.fromEntries([...new Set(peticiones.map((p) => p.llave))].map((l) => [l, peticiones.filter((p) => p.llave === l).length]));

  return { enviar, peticiones, aceptados, porLlave };
}
