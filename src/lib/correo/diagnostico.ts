import "server-only";
import { ConfiguracionDeCorreoInvalida } from "./configuracion";

const NOMBRE = /^[A-Za-z][A-Za-z0-9_]{0,59}$/;
const CODIGO = /^[A-Z0-9_]{1,20}$/;

export function claseDeError(error: unknown): string {
  // Se nombra a la variable pero nunca al valor
  if (error instanceof ConfiguracionDeCorreoInvalida) return `${error.name}: ${error.message}`;
  if (!(error instanceof Error)) return "error desconocido";
  const nombre = NOMBRE.test(error.name) ? error.name : "Error";
  const codigo = (error as { code?: unknown }).code;
  return typeof codigo === "string" && CODIGO.test(codigo) ? `${nombre} ${codigo}` : nombre;
}
