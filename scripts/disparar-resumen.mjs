// Lo corre el proceso cron de Sevalla: node scripts/disparar-resumen.mjs
// JavaScript sin dependencias, porque la imagen no trae curl ni tsx
import { pathToFileURL } from "node:url";

export const SALIDA = { completa: 0, configuracion: 1, rechazo: 2, red: 3, diaNoSano: 4, incidente: 5 };
export const PLAZO_MS = 150_000;

const LOCALES = new Set(["localhost", "127.0.0.1", "[::1]"]);

function destino(entorno) {
  if (!entorno.URL_APLICACION || !entorno.CRON_SECRET) return null;
  let url;
  try {
    url = new URL("/api/tareas/resumen-diario", entorno.URL_APLICACION);
  } catch {
    return null;
  }
  const local = entorno.NODE_ENV !== "production" && url.protocol === "http:" && LOCALES.has(url.hostname);
  return url.protocol === "https:" || local ? url : null;
}

const resumen = (c) =>
  `corrida ${c.corrida} del ${c.fecha}: evaluación ${c.evaluacion?.resultado ?? "ninguna"}, lotes ${JSON.stringify(c.lotes)}, ` +
  `destinatarios ${JSON.stringify(c.destinatarios)}, día ${c.diaSano ? "sano" : `no sano (${(c.motivos ?? []).join(", ")})`}` +
  (c.incidente ? `, incidente ${c.incidente}` : "") +
  (c.detenidaPor ? `, detenida por ${c.detenidaPor}` : "");

/**
 * Devuelve el código de salida. Nunca registra el secreto, los encabezados ni la URL
 * @param {{ entorno?: Record<string, string | undefined>, plazoMs?: number, registrar?: (linea: string) => void, hacerFetch?: typeof fetch }} [opciones]
 * @returns {Promise<number>}
 */
export async function disparar({ entorno = process.env, plazoMs = PLAZO_MS, registrar = console.log, hacerFetch = fetch } = {}) {
  const url = destino(entorno);
  if (!url) {
    registrar("[resumen-diario] configuración inválida: faltan URL_APLICACION o CRON_SECRET, o la URL no usa https");
    return SALIDA.configuracion;
  }
  const inicio = Date.now();
  const segundos = () => ((Date.now() - inicio) / 1000).toFixed(1);
  let respuesta;
  let cuerpo;
  try {
    respuesta = await hacerFetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${entorno.CRON_SECRET}` },
      redirect: "error",
      signal: AbortSignal.timeout(plazoMs),
    });
    cuerpo = await respuesta.json().catch(() => null);
  } catch (error) {
    const motivo = error?.name === "TimeoutError" ? `sin respuesta en ${plazoMs / 1000} s` : `fallo de red (${error?.name ?? "error"})`;
    registrar(`[resumen-diario] ${motivo}`);
    return SALIDA.red;
  }
  if (!respuesta.ok) {
    const detalle = `${cuerpo?.codigo ? ` ${cuerpo.codigo}` : ""}${cuerpo?.corrida ? ` (corrida ${cuerpo.corrida})` : ""}`;
    registrar(`[resumen-diario] la ruta respondió ${respuesta.status}${detalle} en ${segundos()} s`);
    return SALIDA.rechazo;
  }
  if (!cuerpo) {
    registrar(`[resumen-diario] la ruta respondió ${respuesta.status} sin un resumen válido`);
    return SALIDA.rechazo;
  }
  registrar(`[resumen-diario] ${resumen(cuerpo)} en ${segundos()} s`);
  // Un incidente (llave, remitente, cuota) necesita a alguien: la corrida queda fallida en Sevalla
  if (cuerpo.incidente) return SALIDA.incidente;
  return !cuerpo.diaSano && cuerpo.ultimaDeLaVentana ? SALIDA.diaNoSano : SALIDA.completa;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await disparar();
}
