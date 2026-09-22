import { Prisma } from "@prisma/client";

export type CodigoDeDominio =
  | "no-encontrado"
  | "no-es-entrada"
  | "ya-confirmado"
  | "cancelado"
  | "conflicto-idempotencia"
  | "fecha"
  | "moneda"
  | "partidas"
  | "catalogo"
  | "factor-desactualizado"
  | "concurrencia"
  | "invariante"
  | "base-de-datos";

/** Lo que la pantalla puede mostrar tal cual. Nunca lleva SQL ni nombres de tablas. */
export class ErrorDeDominio extends Error {
  constructor(
    readonly codigo: CodigoDeDominio,
    mensaje: string,
    opciones?: { cause?: unknown },
  ) {
    super(mensaje, opciones);
    this.name = "ErrorDeDominio";
  }
}

const MENSAJE_SEGURO = "No se pudo guardar. Revisa los datos e inténtalo de nuevo.";

const CODIGOS_PROPIOS: Record<string, CodigoDeDominio> = {
  BG501: "ya-confirmado",
  BG502: "invariante",
  BG503: "partidas",
  BG504: "factor-desactualizado",
  BG505: "partidas",
  BG506: "partidas",
};

const MENSAJES_FIJOS: Record<string, [CodigoDeDominio, string]> = {
  "23505": ["invariante", "Ya existe un registro con ese valor único."],
  "23503": ["catalogo", "El movimiento hace referencia a un dato que ya no existe."],
  "23514": ["invariante", "Los datos no cumplen una regla del inventario."],
  "40P01": ["concurrencia", "Otro usuario está modificando lo mismo en este momento; inténtalo de nuevo."],
  "40001": ["concurrencia", "Otro usuario está modificando lo mismo en este momento; inténtalo de nuevo."],
};

function esErrorDePrisma(error: unknown): error is Error {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    error instanceof Prisma.PrismaClientValidationError ||
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientRustPanicError
  );
}

function detalleDePostgres(error: Error): { sqlstate: string; mensaje: string } | null {
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

/**
 * Convierte un error de Prisma o PostgreSQL en uno de dominio (11 §11) y
 * falla cerrado: todo error de la base produce un mensaje seguro, y solo los
 * códigos propios conservan su texto. El original va en `cause` y se registra
 * en el servidor. Lo que no viene de la base se relanza intacto.
 */
export function traducirErrorDeBase(error: unknown): never {
  if (error instanceof ErrorDeDominio) throw error;
  if (!esErrorDePrisma(error)) throw error;

  const detalle = detalleDePostgres(error);
  const propio = detalle && CODIGOS_PROPIOS[detalle.sqlstate];
  if (propio && detalle.mensaje) {
    throw new ErrorDeDominio(propio, detalle.mensaje, { cause: error });
  }

  console.error("[entradas] error de base de datos", detalle?.sqlstate ?? error.name, error);
  const [codigo, mensaje] = (detalle && MENSAJES_FIJOS[detalle.sqlstate]) ?? ["base-de-datos", MENSAJE_SEGURO];
  throw new ErrorDeDominio(codigo, mensaje, { cause: error });
}
