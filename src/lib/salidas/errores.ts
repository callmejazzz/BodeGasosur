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

// SQLSTATE propios cuyo texto se escribió para mostrarse (80-salidas.sql,
// 85-conciliacion.sql y 30-inmutabilidad.sql, BG506 en partidas por caja).
const CODIGOS_PROPIOS: Record<string, CodigoDeDominio> = {
  BG601: "estado",
  BG602: "invariante",
  BG603: "partidas",
  BG604: "estado",
  BG605: "invariante",
  BG606: "invariante",
  BG607: "invariante",
  BG506: "partidas",
};

const MENSAJES_FIJOS: Record<string, [CodigoDeDominio, string]> = {
  "23505": ["invariante", "Ya existe un registro con ese valor único."],
  "23503": ["catalogo", "La salida hace referencia a un dato que ya no existe."],
  "23514": ["invariante", "Los datos no cumplen una regla del inventario."],
  "40P01": ["concurrencia", "Otro usuario está modificando lo mismo en este momento; inténtalo de nuevo."],
  "40001": ["concurrencia", "Otro usuario está modificando lo mismo en este momento; inténtalo de nuevo."],
};

/**
 * Falla cerrado, igual que en entradas: todo error de la base sale con un
 * mensaje seguro y solo los códigos propios conservan su texto. El original
 * va en `cause`. Lo que no viene de la base se relanza intacto.
 */
export function traducirErrorDeBase(error: unknown): never {
  if (error instanceof ErrorDeDominio) throw error;
  if (!esErrorDePrisma(error)) throw error;

  const detalle = detalleDePostgres(error);
  const propio = detalle && CODIGOS_PROPIOS[detalle.sqlstate];
  if (propio && detalle.mensaje) {
    throw new ErrorDeDominio(propio, detalle.mensaje, { cause: error });
  }

  console.error("[salidas] error de base de datos", detalle?.sqlstate ?? error.name, error);
  const [codigo, mensaje] = (detalle && MENSAJES_FIJOS[detalle.sqlstate]) ?? ["base-de-datos", MENSAJE_SEGURO];
  throw new ErrorDeDominio(codigo, mensaje, { cause: error });
}

/**
 * La acción protegida completa, traducida: un trigger diferido falla al
 * confirmar, cuando el servicio ya terminó, y su error sale de accionProtegida.
 */
export function traducida<A extends unknown[], T>(accion: (...args: A) => Promise<T>): (...args: A) => Promise<T> {
  return (...args) => accion(...args).catch(traducirErrorDeBase);
}
