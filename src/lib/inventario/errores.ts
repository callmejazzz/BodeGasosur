import { detalleDePostgres, esErrorDePrisma } from "@/lib/movimientos/errores";

export type CodigoDeDominio =
  | "no-encontrado"
  | "estado"
  | "conflicto"
  | "conflicto-idempotencia"
  | "datos"
  | "partidas"
  | "catalogo"
  | "factor-desactualizado"
  | "existencia"
  | "saldo"
  | "conteo-obsoleto"
  | "dependientes"
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

// SQLSTATE propios cuyo texto se escribió para mostrarse (30-inmutabilidad,
// 85-conciliacion y 990-traspasos-devoluciones-conteo).
const CODIGOS_PROPIOS: Record<string, CodigoDeDominio> = {
  BG501: "estado",
  BG502: "estado",
  BG503: "partidas",
  BG504: "factor-desactualizado",
  BG506: "partidas",
  BG606: "invariante",
  BG607: "invariante",
  BG801: "estado",
  BG802: "dependientes",
  BG803: "saldo",
  BG804: "invariante",
  BG805: "conteo-obsoleto",
};

const MENSAJES_FIJOS: Record<string, [CodigoDeDominio, string]> = {
  "23505": ["invariante", "Ya existe un registro con ese valor único."],
  "23503": ["catalogo", "El movimiento hace referencia a un dato que ya no existe."],
  "23514": ["invariante", "Los datos no cumplen una regla del inventario."],
  "40P01": ["concurrencia", "Otro usuario está modificando lo mismo en este momento; inténtalo de nuevo."],
  "40001": ["concurrencia", "Otro usuario está modificando lo mismo en este momento; inténtalo de nuevo."],
};

/**
 * Falla cerrado, como en entradas y salidas: todo error de la base sale con
 * un mensaje seguro y solo los códigos propios conservan su texto. El
 * original va en `cause`. Lo que no viene de la base se relanza intacto.
 */
export function traducirErrorDeBase(error: unknown): never {
  if (error instanceof ErrorDeDominio) throw error;
  if (!esErrorDePrisma(error)) throw error;

  const detalle = detalleDePostgres(error);
  const propio = detalle && CODIGOS_PROPIOS[detalle.sqlstate];
  if (propio && detalle.mensaje) {
    throw new ErrorDeDominio(propio, detalle.mensaje, { cause: error });
  }

  console.error("[inventario] error de base de datos", detalle?.sqlstate ?? error.name, error);
  const [codigo, mensaje] = (detalle && MENSAJES_FIJOS[detalle.sqlstate]) ?? ["base-de-datos", MENSAJE_SEGURO];
  throw new ErrorDeDominio(codigo, mensaje, { cause: error });
}

/** La acción protegida completa, traducida: un trigger diferido falla al confirmar, ya fuera del servicio. */
export function traducida<A extends unknown[], T>(accion: (...args: A) => Promise<T>): (...args: A) => Promise<T> {
  return (...args) => accion(...args).catch(traducirErrorDeBase);
}
