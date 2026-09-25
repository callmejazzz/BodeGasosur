import { Prisma } from "@prisma/client";

// Lectura de errores de Prisma/PostgreSQL. La política de qué se muestra vive
// en el traductor de cada dominio; aquí solo se extrae el SQLSTATE.

/**
 * Lo que el adaptador de pg lanza tal cual, sin envolverlo en un error de
 * Prisma: por ejemplo, el COMMIT que rechaza un trigger diferido. Se reconoce
 * por su forma para no depender de @prisma/driver-adapter-utils.
 */
type FallaDelAdaptador = Error & { cause: { originalCode?: unknown; originalMessage?: unknown } };

function esFallaDelAdaptador(error: unknown): error is FallaDelAdaptador {
  return error instanceof Error && error.name === "DriverAdapterError" && typeof error.cause === "object" && error.cause !== null;
}

export function esErrorDePrisma(error: unknown): error is Error {
  return (
    esFallaDelAdaptador(error) ||
    error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    error instanceof Prisma.PrismaClientValidationError ||
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientRustPanicError
  );
}

export function detalleDePostgres(error: Error): { sqlstate: string; mensaje: string } | null {
  if (esFallaDelAdaptador(error)) {
    const { originalCode, originalMessage } = error.cause;
    return typeof originalCode === "string" ? { sqlstate: originalCode, mensaje: typeof originalMessage === "string" ? originalMessage : "" } : null;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") return { sqlstate: "23505", mensaje: "" };
    if (error.code === "P2003") return { sqlstate: "23503", mensaje: "" };
    if (error.code === "P2034") return { sqlstate: "40001", mensaje: "" };
    const meta = error.meta as { code?: string; message?: string } | undefined;
    if (meta?.code) return { sqlstate: meta.code, mensaje: meta.message ?? "" };
  }
  const m = /Code: `([0-9A-Z]{5})`\. Message: `([^`]*)`/.exec(error.message);
  return m ? { sqlstate: m[1], mensaje: m[2] } : null;
}

/** El error es la violación de un índice único que incluye `columna`. */
export function chocaCon(error: unknown, columna: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const meta = error.meta as
    | { target?: string[]; driverAdapterError?: { cause?: { constraint?: { fields?: string[] } } } }
    | undefined;
  const campos = meta?.driverAdapterError?.cause?.constraint?.fields ?? meta?.target ?? [];
  return campos.some((c) => c.replaceAll('"', "") === columna);
}
