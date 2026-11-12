import "server-only";

export class ConfiguracionDeCorreoInvalida extends Error {
  constructor(variable: string, motivo: string) {
    super(`${variable} ${motivo}.`);
    this.name = "ConfiguracionDeCorreoInvalida";
  }
}

export type ConfiguracionDeCorreo = { remitente: string; urlAplicacion: URL };

// «Nombre <dir@dominio>» o «dir@dominio», sin saltos ni caracteres de control
const REMITENTE = /^(?:[^<>@\p{Cc}]+ <[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>|[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)$/u;
const LOCALES = new Set(["localhost", "127.0.0.1", "[::1]"]);

function remitente(valor: string | undefined): string {
  const r = valor?.trim() ?? "";
  if (!r) throw new ConfiguracionDeCorreoInvalida("CORREO_REMITENTE", "no está definida");
  if (!REMITENTE.test(r)) throw new ConfiguracionDeCorreoInvalida("CORREO_REMITENTE", "no es una dirección válida");
  return r;
}

/** Solo el origen: https, o http en la propia máquina fuera de producción. Sin credenciales, ruta ni parámetros. */
function urlAplicacion(valor: string | undefined, produccion: boolean): URL {
  const texto = valor?.trim() ?? "";
  if (!texto) throw new ConfiguracionDeCorreoInvalida("URL_APLICACION", "no está definida");
  let url: URL;
  try {
    url = new URL(texto);
  } catch {
    throw new ConfiguracionDeCorreoInvalida("URL_APLICACION", "no es una URL válida");
  }
  const localPermitida = !produccion && url.protocol === "http:" && LOCALES.has(url.hostname);
  if (url.protocol !== "https:" && !localPermitida) {
    throw new ConfiguracionDeCorreoInvalida("URL_APLICACION", produccion ? "debe usar https en producción" : "debe usar https");
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new ConfiguracionDeCorreoInvalida("URL_APLICACION", "debe ser solo el origen, sin credenciales, ruta ni parámetros");
  }
  return url;
}

export function configuracionDeCorreo(entorno: Record<string, string | undefined> = process.env): ConfiguracionDeCorreo {
  return {
    remitente: remitente(entorno.CORREO_REMITENTE),
    urlAplicacion: urlAplicacion(entorno.URL_APLICACION, entorno.NODE_ENV === "production"),
  };
}

function secreto(entorno: Record<string, string | undefined>, variable: string, prefijo: string): string {
  const valor = entorno[variable]?.trim() ?? "";
  if (!valor) throw new ConfiguracionDeCorreoInvalida(variable, "no está definida");
  if (!valor.startsWith(prefijo) || valor.length <= prefijo.length) throw new ConfiguracionDeCorreoInvalida(variable, `debe empezar con ${prefijo}`);
  return valor;
}

export const llaveDeResend = (entorno: Record<string, string | undefined> = process.env) => secreto(entorno, "RESEND_API_KEY", "re_");

export const secretoDelWebhook = (entorno: Record<string, string | undefined> = process.env) => secreto(entorno, "RESEND_WEBHOOK_SECRET", "whsec_");
