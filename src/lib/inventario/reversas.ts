import type { EstatusMovimiento, Prisma, TipoMovimiento } from "@prisma/client";
import type { UsuarioSesion } from "@/lib/db";
import { aFechaDeBase, hoyEnMexico } from "@/lib/fechas";
import {
  asegurarYBloquearExistenciasDe,
  bloquearArticulos,
  descontarExistencias,
  excesoDeCapacidad,
  incrementarExistencias,
  tomarFolio,
} from "@/lib/movimientos/primitivas";
import { textoObligatorio, transicionar } from "./captura";
import { ErrorDeDominio, traducirErrorDeBase } from "./errores";
import { bloquearCapasDelOriginal, restituirConsumosDelOriginal, retirarCapasDelOriginal } from "./primitivas";

/*
  Reversa de un movimiento que ya afectó el inventario (contrato de la fase 7,
  §2.5). No es una transición del original: es otro asiento confirmado, ligado
  por cancelaAId, con motivo, actor, fecha y folio propios. Un traspaso se
  revierte con otro traspaso en sentido contrario; todo lo demás con un
  AJUSTE. Para un ingreso retira sus capas exactas, que tienen que seguir
  completas; para un egreso devuelve cada consumo a su capa exacta. Nada
  histórico se borra ni se reescribe. Solo el Superadmin la ejecuta.
*/

type Tx = Prisma.TransactionClient;

/** `revierteA` es el original: la reversa de un traspaso se consulta desde él. */
export type ResultadoReversa = { id: string; tipo: "AJUSTE" | "TRASPASO"; folio: string; revierteA: string; repetido: boolean };

type Original = {
  id: string;
  tipo: TipoMovimiento;
  estatus: EstatusMovimiento;
  folio: string | null;
  bodegaOrigenId: string | null;
  bodegaDestinoId: string | null;
  devuelveAId: string | null;
  cancelaAId: string | null;
};

const NOMBRE: Record<TipoMovimiento, string> = {
  ENTRADA: "La entrada",
  SALIDA: "La salida",
  TRASPASO: "El traspaso",
  DEVOLUCION: "La devolución",
  AJUSTE: "El ajuste",
};

const afectoInventario = (o: Original) =>
  o.tipo === "SALIDA" ? o.estatus === "RETIRADA" || o.estatus === "RECIBIDA" : o.estatus === "CONFIRMADO";

/**
 * Los candados de encabezado, en orden de id: el original y, si es una
 * devolución vinculada, su salida, cuyo saldo de préstamo vuelve a subir.
 */
async function bloquearOriginal(tx: Tx, id: string): Promise<Original> {
  const [previo] = await tx.$queryRaw<{ devuelveAId: string | null }[]>`SELECT "devuelveAId" FROM "Movimiento" WHERE id = ${id}::uuid`;
  if (!previo) throw new ErrorDeDominio("no-encontrado", "El movimiento no existe.");
  const ids = [id, previo.devuelveAId].filter((x): x is string => !!x).sort();
  await tx.$queryRaw`SELECT id FROM "Movimiento" WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
  const [o] = await tx.$queryRaw<Original[]>`
    SELECT id, tipo, estatus, folio, "bodegaOrigenId", "bodegaDestinoId", "devuelveAId", "cancelaAId"
    FROM "Movimiento" WHERE id = ${id}::uuid`;
  // Un borrador se puede borrar mientras se esperaba el candado.
  if (!o) throw new ErrorDeDominio("no-encontrado", "El movimiento no existe.");
  return o;
}

/** Los movimientos vigentes que ya usaron alguna capa del original: hay que revertirlos antes. */
async function dependientes(tx: Tx, originalId: string): Promise<string[]> {
  const filas = await tx.$queryRaw<{ folio: string | null }[]>`
    SELECT DISTINCT m.folio FROM "CapaCosto" c
    JOIN "ConsumoCapa" k ON k."capaId" = c.id
    JOIN "MovimientoPartida" p ON p.id = k."partidaId"
    JOIN "Movimiento" m ON m.id = p."movimientoId"
    WHERE c."movimientoId" = ${originalId}::uuid
      AND NOT EXISTS (SELECT 1 FROM "RestitucionCapa" r WHERE r."consumoId" = k.id)
    ORDER BY m.folio`;
  return filas.map((f) => f.folio ?? "un movimiento sin folio");
}

export async function revertirMovimiento(tx: Tx, usuario: UsuarioSesion, id: string, motivo: string): Promise<ResultadoReversa> {
  try {
    const texto = textoObligatorio(motivo, "Di por qué se revierte el movimiento.");
    const o = await bloquearOriginal(tx, id);
    const nombre = NOMBRE[o.tipo];
    if (o.cancelaAId) throw new ErrorDeDominio("estado", "Una reversa no se revierte.");

    const previa = await tx.movimiento.findUnique({ where: { cancelaAId: o.id }, select: { id: true, tipo: true, folio: true, motivo: true } });
    if (previa) {
      if (previa.motivo === texto) return { id: previa.id, tipo: previa.tipo as ResultadoReversa["tipo"], folio: previa.folio!, revierteA: o.id, repetido: true };
      throw new ErrorDeDominio("conflicto", `${nombre} ${o.folio} ya se revirtió con ${previa.folio}.`);
    }
    if (!afectoInventario(o)) {
      throw new ErrorDeDominio(
        "estado",
        o.tipo === "SALIDA"
          ? "Una salida sin retirar no se revierte: se cancela."
          : `${nombre} no afectó el inventario: un borrador se descarta, no se revierte.`,
      );
    }

    if (o.tipo === "SALIDA") {
      const devoluciones = await tx.$queryRaw<{ folio: string }[]>`
        SELECT folio FROM "Movimiento" d WHERE d."devuelveAId" = ${o.id}::uuid AND devolucion_vigente(d.id) ORDER BY folio`;
      if (devoluciones.length > 0) {
        throw new ErrorDeDominio(
          "dependientes",
          `La salida ${o.folio} tiene devoluciones vigentes (${devoluciones.map((d) => d.folio).join(", ")}): revierte primero esas devoluciones.`,
        );
      }
    }

    // La reversa mueve las mismas bodegas en sentido contrario.
    const origen = o.bodegaDestinoId;
    const destino = o.bodegaOrigenId;
    const bodegas = [origen, destino].filter((b): b is string => !!b).sort();
    const activas = await tx.$queryRaw<{ id: string; activa: boolean }[]>`
      SELECT id, activa FROM "Bodega" WHERE id = ANY(${bodegas}::uuid[]) ORDER BY id FOR SHARE`;
    if (destino && !activas.find((b) => b.id === destino)?.activa) {
      throw new ErrorDeDominio("catalogo", "La bodega a la que volvería el material está dada de baja; reactívala antes de revertir.");
    }

    const partidas = await tx.movimientoPartida.findMany({ where: { movimientoId: o.id }, select: { articuloId: true, cantidad: true }, orderBy: { orden: "asc" } });
    const articuloIds = partidas.map((p) => p.articuloId);
    await bloquearArticulos(tx, articuloIds);
    await asegurarYBloquearExistenciasDe(tx, bodegas.flatMap((bodegaId) => articuloIds.map((articuloId) => ({ bodegaId, articuloId }))));
    await bloquearCapasDelOriginal(tx, o.id);

    if (origen) {
      const usadas = await dependientes(tx, o.id);
      if (usadas.length > 0) {
        throw new ErrorDeDominio(
          "dependientes",
          `${nombre} ${o.folio} ya se usó en ${usadas.join(", ")}: revierte primero esos movimientos.`,
        );
      }
    }

    const hoy = aFechaDeBase(hoyEnMexico());
    const tipo = o.tipo === "TRASPASO" ? "TRASPASO" : "AJUSTE";
    const { id: reversaId } = await tx.movimiento.create({
      data: {
        tipo,
        estatus: "BORRADOR",
        fecha: hoy,
        bodegaOrigenId: origen,
        bodegaDestinoId: destino,
        motivo: texto,
        cancelaAId: o.id,
        creadoPorId: usuario.id,
        partidas: {
          create: partidas.map((p, i) => ({
            orden: i + 1,
            articuloId: p.articuloId,
            presentacionCapturada: "UNIDAD" as const,
            cantidadCapturada: p.cantidad,
            factorConversion: 1,
            cantidad: p.cantidad,
          })),
        },
      },
      select: { id: true },
    });

    const piezas = partidas.reduce((n, p) => n + p.cantidad, 0);
    if (origen) {
      const retiro = await retirarCapasDelOriginal(tx, reversaId, o.id);
      if (retiro.piezas !== piezas || (await descontarExistencias(tx, reversaId, origen)) !== partidas.length) {
        throw new ErrorDeDominio("invariante", `Las capas de ${o.folio} no cubren sus partidas; no se revirtió nada.`);
      }
    }
    if (destino) {
      if (await excesoDeCapacidad(tx, reversaId, destino)) {
        throw new ErrorDeDominio("partidas", "La existencia más lo que vuelve rebasa lo que el sistema puede registrar.");
      }
      const restitucion = await restituirConsumosDelOriginal(tx, reversaId, o.id);
      if (restitucion.piezas !== piezas || (await incrementarExistencias(tx, reversaId, destino)) !== partidas.length) {
        throw new ErrorDeDominio("invariante", `Los consumos de ${o.folio} no cubren sus partidas; no se revirtió nada.`);
      }
    }

    const folio = await tomarFolio(tx, tipo);
    await transicionar(tx, reversaId, "BORRADOR", { estatus: "CONFIRMADO", folio, confirmadoPorId: usuario.id, confirmadoEn: new Date() });
    return { id: reversaId, tipo, folio, revierteA: o.id, repetido: false };
  } catch (error) {
    traducirErrorDeBase(error);
  }
}
