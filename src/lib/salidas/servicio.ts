import type { EstatusMovimiento, Prisma, Presentacion } from "@prisma/client";
import type { UsuarioSesion } from "@/lib/db";
import { aFechaDeBase, hoyEnMexico } from "@/lib/fechas";
import { chocaCon } from "@/lib/movimientos/errores";
import { asegurarYBloquearExistencias, aUnidadBase, bloquearArticulos, tomarFolio } from "@/lib/movimientos/primitivas";
import { ErrorDeDominio, traducirErrorDeBase } from "./errores";
import {
  bloquearCapasVivas,
  bloquearContrapartes,
  consumirCapasPEPS,
  descontarExistencias,
  verificarExistencias,
} from "./primitivas";

/*
  Cada función recibe `tx` y `usuario` de accionProtegida(): el actor sale de
  la sesión, nunca de un argumento, y la puerta vuelve a exigir su permiso
  dentro de la transacción. Lo que viene del navegador se vuelve a
  validar aquí y el factor de conversión se deriva del catálogo.
*/

type Tx = Prisma.TransactionClient;

export type EstatusSalida = Extract<
  EstatusMovimiento,
  "SOLICITADA" | "AUTORIZADA" | "RECHAZADA" | "RETIRADA" | "RECIBIDA" | "CANCELADO"
>;

export type PartidaSolicitada = {
  articuloId: string;
  presentacion: Presentacion;
  cantidadCapturada: number;
  observaciones?: string | null;
};

export type EncabezadoSolicitado = {
  bodegaOrigenId: string;
  estacionId: string;
  solicitadoPorId?: string | null;
  areaId?: string | null;
  esPrestamo?: boolean;
  observaciones?: string | null;
};

export type DatosSolicitud = { encabezado: EncabezadoSolicitado; partidas: PartidaSolicitada[] };

export type ResultadoAlta = { id: string; repetido: boolean };
export type ResultadoTransicion = { id: string; estatus: EstatusSalida; repetido: boolean };
export type ResultadoRetiro = { id: string; folio: string; repetido: boolean };

// ─────────────────────────────── Encabezado ──────────────────────────────────

type Encabezado = {
  id: string;
  tipo: string;
  estatus: EstatusSalida;
  folio: string | null;
  bodegaOrigenId: string;
  estacionId: string;
  areaId: string | null;
  solicitadoPorId: string | null;
  motivoRechazo: string | null;
  motivoCancelacion: string | null;
};

/** El reclamo de toda transición: FOR UPDATE del encabezado y, bajo el candado, su estatus. */
async function bloquearSalida(tx: Tx, id: string): Promise<Encabezado> {
  const filas = await tx.$queryRaw<Encabezado[]>`
    SELECT id, tipo::text, estatus::text, folio, "bodegaOrigenId", "estacionId", "areaId", "solicitadoPorId",
           "motivoRechazo", "motivoCancelacion"
    FROM "Movimiento" WHERE id = ${id}::uuid FOR UPDATE`;
  const m = filas[0];
  // Otro tipo de movimiento responde igual que uno inexistente.
  if (!m || m.tipo !== "SALIDA") throw new ErrorDeDominio("no-encontrado", "La salida no existe.");
  return m;
}

const SITUACION: Record<EstatusSalida, (m: Encabezado) => string> = {
  SOLICITADA: () => "la salida todavía no está autorizada",
  AUTORIZADA: () => "la salida ya está autorizada",
  RECHAZADA: () => "la salida fue rechazada",
  CANCELADO: () => "la salida fue cancelada",
  RETIRADA: (m) => `la salida ${m.folio} ya se retiró de la bodega`,
  RECIBIDA: (m) => `la salida ${m.folio} ya se recibió`,
};

function estadoInvalido(m: Encabezado, accion: string): ErrorDeDominio {
  return new ErrorDeDominio("estado", `No se puede ${accion}: ${SITUACION[m.estatus](m)}.`);
}

/** El cambio de estatus condicionado al de origen; con el candado tomado siempre afecta una fila. */
async function transicionar(
  tx: Tx,
  id: string,
  desde: EstatusSalida,
  data: Prisma.MovimientoUncheckedUpdateManyInput,
): Promise<void> {
  const { count } = await tx.movimiento.updateMany({ where: { id, estatus: desde }, data });
  if (count !== 1) throw new ErrorDeDominio("concurrencia", "La salida cambió mientras se guardaba; vuelve a intentarlo.");
}

function textoObligatorio(valor: string, pregunta: string): string {
  const limpio = valor.trim();
  if (!limpio) throw new ErrorDeDominio("datos", pregunta);
  return limpio;
}

// ──────────────────────────────── Solicitud ──────────────────────────────────

type PartidaNormalizada = {
  articuloId: string;
  presentacion: Presentacion;
  cantidadCapturada: number;
  factorConversion: number;
  cantidad: number;
  observaciones: string | null;
};

type DatosNormalizados = {
  encabezado: {
    bodegaOrigenId: string;
    estacionId: string;
    solicitadoPorId: string | null;
    areaId: string | null;
    esPrestamo: boolean;
    observaciones: string | null;
  };
  partidas: PartidaNormalizada[];
};

async function normalizar(tx: Tx, datos: DatosSolicitud): Promise<DatosNormalizados> {
  const { encabezado: e, partidas } = datos;
  if (partidas.length === 0) throw new ErrorDeDominio("partidas", "La solicitud necesita al menos una partida.");
  if (partidas.length > 200) throw new ErrorDeDominio("partidas", "Demasiadas partidas en una sola salida.");

  const ids = partidas.map((p) => p.articuloId);
  if (new Set(ids).size !== ids.length) {
    throw new ErrorDeDominio("partidas", "Un artículo no puede aparecer dos veces en la misma salida.");
  }

  // Las bajas y los cambios de factor esperan a que esta captura confirme.
  await bloquearContrapartes(tx, {
    bodegaOrigenId: e.bodegaOrigenId,
    estacionId: e.estacionId,
    areaId: e.areaId ?? null,
    solicitadoPorId: e.solicitadoPorId ?? null,
  });
  await bloquearArticulos(tx, ids);

  // Secuencial a propósito: dentro de una transacción hay una sola conexión.
  const bodega = await tx.bodega.findUnique({ where: { id: e.bodegaOrigenId }, select: { activa: true } });
  const estacion = await tx.estacion.findUnique({ where: { id: e.estacionId }, select: { activa: true } });
  if (!bodega?.activa) throw new ErrorDeDominio("catalogo", "La bodega de origen no existe o está dada de baja.");
  if (!estacion?.activa) throw new ErrorDeDominio("catalogo", "La estación no existe o está dada de baja.");
  if (e.areaId) {
    const area = await tx.area.findUnique({ where: { id: e.areaId }, select: { activa: true } });
    if (!area?.activa) throw new ErrorDeDominio("catalogo", "El área no existe o está dada de baja.");
  }
  if (e.solicitadoPorId) {
    const persona = await tx.persona.findUnique({ where: { id: e.solicitadoPorId }, select: { activa: true } });
    if (!persona?.activa) throw new ErrorDeDominio("catalogo", "El solicitante no existe o está dado de baja.");
  }

  const articulos = new Map(
    (
      await tx.articulo.findMany({
        where: { id: { in: ids } },
        select: { id: true, clave: true, activo: true, piezasPorCaja: true },
      })
    ).map((a) => [a.id, a]),
  );

  return {
    encabezado: {
      bodegaOrigenId: e.bodegaOrigenId,
      estacionId: e.estacionId,
      solicitadoPorId: e.solicitadoPorId || null,
      areaId: e.areaId || null,
      esPrestamo: e.esPrestamo === true,
      observaciones: e.observaciones?.trim() || null,
    },
    partidas: partidas.map((p) => {
      const articulo = articulos.get(p.articuloId);
      if (!articulo?.activo) throw new ErrorDeDominio("catalogo", "Un artículo de la salida no existe o está dado de baja.");
      const base = aUnidadBase(articulo.clave, p.presentacion, p.cantidadCapturada, articulo.piezasPorCaja);
      if ("error" in base) throw new ErrorDeDominio("partidas", base.error);
      return {
        articuloId: p.articuloId,
        presentacion: p.presentacion,
        cantidadCapturada: p.cantidadCapturada,
        ...base,
        observaciones: p.observaciones?.trim() || null,
      };
    }),
  };
}

/**
 * SOLICITADA, con sus partidas, en una transacción. Sin folio, costos,
 * consumo ni existencia. La llave viene del formulario y es única: repetirla
 * con la misma captura devuelve la solicitud; con otra, es conflicto. El
 * savepoint cubre la carrera de dos altas simultáneas con la misma llave.
 */
export async function solicitarSalida(
  tx: Tx,
  usuario: UsuarioSesion,
  llaveIdempotencia: string,
  datos: DatosSolicitud,
): Promise<ResultadoAlta> {
  try {
    const previo = await resolverRepeticion(tx, usuario, llaveIdempotencia, datos);
    if (previo) return { id: previo, repetido: true };

    const { encabezado: e, partidas } = await normalizar(tx, datos);

    await tx.$executeRawUnsafe("SAVEPOINT alta_salida");
    let creado: { id: string };
    try {
      creado = await tx.movimiento.create({
        data: {
          tipo: "SALIDA",
          estatus: "SOLICITADA",
          llaveIdempotencia,
          // Provisional: el retiro la fija al día en que sale el material.
          fecha: aFechaDeBase(hoyEnMexico()),
          bodegaOrigenId: e.bodegaOrigenId,
          estacionId: e.estacionId,
          solicitadoPorId: e.solicitadoPorId,
          areaId: e.areaId,
          esPrestamo: e.esPrestamo,
          observaciones: e.observaciones,
          creadoPorId: usuario.id,
          partidas: {
            create: partidas.map((p, i) => ({
              orden: i + 1,
              articuloId: p.articuloId,
              presentacionCapturada: p.presentacion,
              cantidadCapturada: p.cantidadCapturada,
              factorConversion: p.factorConversion,
              cantidad: p.cantidad,
              observaciones: p.observaciones,
            })),
          },
        },
        select: { id: true },
      });
    } catch (error) {
      if (!chocaCon(error, "llaveIdempotencia")) throw error;
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT alta_salida");
      const ganador = await resolverRepeticion(tx, usuario, llaveIdempotencia, datos);
      if (!ganador) throw new ErrorDeDominio("concurrencia", "La captura se cruzó con otra; inténtalo de nuevo.");
      return { id: ganador, repetido: true };
    }
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT alta_salida");
    return { id: creado.id, repetido: false };
  } catch (error) {
    traducirErrorDeBase(error);
  }
}

/** Nulo si la llave no existe; el id si es del mismo usuario, de una salida y con la misma captura. */
async function resolverRepeticion(
  tx: Tx,
  usuario: UsuarioSesion,
  llaveIdempotencia: string,
  datos: DatosSolicitud,
): Promise<string | null> {
  const existente = await tx.movimiento.findUnique({
    where: { llaveIdempotencia },
    include: { partidas: true },
  });
  if (!existente) return null;

  const conflicto = () =>
    new ErrorDeDominio("conflicto-idempotencia", "Esta captura ya se envió con otros datos. Abre la salida guardada.");
  if (existente.tipo !== "SALIDA" || existente.creadoPorId !== usuario.id) throw conflicto();
  if (firmaDeCaptura(datos) !== firmaDeGuardado(existente)) throw conflicto();
  return existente.id;
}

// Representación canónica de la captura: solo lo que la persona escribió,
// con claves fijas, partidas ordenadas y JSON.stringify (como en entradas).

const textoCanonico = (v: string | null | undefined) => (v ?? "").trim();
const idCanonico = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

type PartidaCanonica = { articuloId: string; presentacion: string; cantidadCapturada: number; observaciones: string };

function firma(c: {
  bodegaOrigenId: string;
  estacionId: string;
  solicitadoPorId: string;
  areaId: string;
  esPrestamo: boolean;
  observaciones: string;
  partidas: PartidaCanonica[];
}): string {
  const partidas = c.partidas.map((p) => JSON.stringify(p)).sort();
  return JSON.stringify({ ...c, partidas });
}

function firmaDeCaptura(d: DatosSolicitud): string {
  const e = d.encabezado;
  return firma({
    bodegaOrigenId: idCanonico(e.bodegaOrigenId),
    estacionId: idCanonico(e.estacionId),
    solicitadoPorId: idCanonico(e.solicitadoPorId),
    areaId: idCanonico(e.areaId),
    esPrestamo: e.esPrestamo === true,
    observaciones: textoCanonico(e.observaciones),
    partidas: d.partidas.map((p) => ({
      articuloId: idCanonico(p.articuloId),
      presentacion: p.presentacion,
      cantidadCapturada: p.cantidadCapturada,
      observaciones: textoCanonico(p.observaciones),
    })),
  });
}

function firmaDeGuardado(m: {
  bodegaOrigenId: string | null;
  estacionId: string | null;
  solicitadoPorId: string | null;
  areaId: string | null;
  esPrestamo: boolean;
  observaciones: string | null;
  partidas: { articuloId: string; presentacionCapturada: string; cantidadCapturada: number; observaciones: string | null }[];
}): string {
  return firma({
    bodegaOrigenId: idCanonico(m.bodegaOrigenId),
    estacionId: idCanonico(m.estacionId),
    solicitadoPorId: idCanonico(m.solicitadoPorId),
    areaId: idCanonico(m.areaId),
    esPrestamo: m.esPrestamo,
    observaciones: textoCanonico(m.observaciones),
    partidas: m.partidas.map((p) => ({
      articuloId: idCanonico(p.articuloId),
      presentacion: p.presentacionCapturada,
      cantidadCapturada: p.cantidadCapturada,
      observaciones: textoCanonico(p.observaciones),
    })),
  });
}

// ─────────────────── Autorización, rechazo y cancelación ─────────────────────

/** SOLICITADA → AUTORIZADA. No reserva inventario ni asigna folio. */
export async function autorizarSalida(tx: Tx, usuario: UsuarioSesion, id: string): Promise<ResultadoTransicion> {
  try {
    const m = await bloquearSalida(tx, id);
    // Ya autorizada, aunque después se haya retirado: el resultado original.
    if (m.estatus === "AUTORIZADA" || m.estatus === "RETIRADA" || m.estatus === "RECIBIDA") {
      return { id, estatus: m.estatus, repetido: true };
    }
    if (m.estatus !== "SOLICITADA") throw estadoInvalido(m, "autorizar");
    if ((await tx.movimientoPartida.count({ where: { movimientoId: id } })) === 0) {
      throw new ErrorDeDominio("partidas", "La salida no tiene partidas.");
    }

    await transicionar(tx, id, "SOLICITADA", { estatus: "AUTORIZADA", autorizadoPorId: usuario.id, autorizadoEn: new Date() });
    return { id, estatus: "AUTORIZADA", repetido: false };
  } catch (error) {
    traducirErrorDeBase(error);
  }
}

/** SOLICITADA → RECHAZADA, con motivo. Repetirla con otro motivo es conflicto. */
export async function rechazarSalida(tx: Tx, usuario: UsuarioSesion, id: string, motivo: string): Promise<ResultadoTransicion> {
  try {
    const motivoRechazo = textoObligatorio(motivo, "Di por qué se rechaza la salida.");
    const m = await bloquearSalida(tx, id);
    if (m.estatus === "RECHAZADA") {
      if (m.motivoRechazo === motivoRechazo) return { id, estatus: "RECHAZADA", repetido: true };
      throw new ErrorDeDominio("conflicto", "La salida ya se rechazó con otro motivo.");
    }
    if (m.estatus !== "SOLICITADA") throw estadoInvalido(m, "rechazar");

    await transicionar(tx, id, "SOLICITADA", {
      estatus: "RECHAZADA",
      motivoRechazo,
      rechazadoPorId: usuario.id,
      rechazadoEn: new Date(),
    });
    return { id, estatus: "RECHAZADA", repetido: false };
  } catch (error) {
    traducirErrorDeBase(error);
  }
}

/** SOLICITADA o AUTORIZADA → CANCELADO, con motivo. Lo retirado se revierte en la fase 7, no aquí. */
export async function cancelarSalida(tx: Tx, usuario: UsuarioSesion, id: string, motivo: string): Promise<ResultadoTransicion> {
  try {
    const motivoCancelacion = textoObligatorio(motivo, "Di por qué se cancela la salida.");
    const m = await bloquearSalida(tx, id);
    if (m.estatus === "CANCELADO") {
      if (m.motivoCancelacion === motivoCancelacion) return { id, estatus: "CANCELADO", repetido: true };
      throw new ErrorDeDominio("conflicto", "La salida ya se canceló con otro motivo.");
    }
    if (m.estatus !== "SOLICITADA" && m.estatus !== "AUTORIZADA") throw estadoInvalido(m, "cancelar");

    await transicionar(tx, id, m.estatus, {
      estatus: "CANCELADO",
      motivoCancelacion,
      canceladoPorId: usuario.id,
      canceladoEn: new Date(),
    });
    return { id, estatus: "CANCELADO", repetido: false };
  } catch (error) {
    traducirErrorDeBase(error);
  }
}

// ───────────────────────────────── Retiro ────────────────────────────────────

/**
 * AUTORIZADA → RETIRADA en una transacción: valida catálogo y factor bajo sus
 * candados, consume capas PEPS, descuenta existencia, toma el folio y cambia
 * el estatus. Cualquier falla revierte todo, folio incluido. Un reintento
 * sobre RETIRADA o RECIBIDA devuelve el mismo folio sin escribir.
 */
export async function retirarSalida(
  tx: Tx,
  usuario: UsuarioSesion,
  id: string,
  entregadoA: string,
): Promise<ResultadoRetiro> {
  try {
    const m = await bloquearSalida(tx, id);
    if (m.estatus === "RETIRADA" || m.estatus === "RECIBIDA") return { id, folio: m.folio!, repetido: true };
    if (m.estatus !== "AUTORIZADA") throw estadoInvalido(m, "retirar");
    const quien = textoObligatorio(entregadoA, "Di quién se lleva el material.");

    await bloquearContrapartes(tx, m);
    const articuloIds = (
      await tx.movimientoPartida.findMany({ where: { movimientoId: id }, select: { articuloId: true } })
    ).map((p) => p.articuloId);
    await bloquearArticulos(tx, articuloIds);

    // Lo validado es lo que se retira: se lee después de tomar los candados.
    const salida = await tx.movimiento.findUniqueOrThrow({
      where: { id },
      select: {
        bodegaOrigen: { select: { activa: true } },
        estacion: { select: { activa: true } },
        area: { select: { activa: true } },
        solicitadoPor: { select: { activa: true } },
        partidas: {
          select: {
            presentacionCapturada: true,
            factorConversion: true,
            cantidad: true,
            articulo: { select: { clave: true, activo: true, piezasPorCaja: true } },
          },
        },
      },
    });
    if (!salida.bodegaOrigen?.activa) throw new ErrorDeDominio("catalogo", "La bodega de origen está dada de baja.");
    if (!salida.estacion?.activa) throw new ErrorDeDominio("catalogo", "La estación está dada de baja.");
    if (salida.area && !salida.area.activa) throw new ErrorDeDominio("catalogo", "El área está dada de baja.");
    if (salida.solicitadoPor && !salida.solicitadoPor.activa) {
      throw new ErrorDeDominio("catalogo", "El solicitante está dado de baja.");
    }
    if (salida.partidas.length === 0) throw new ErrorDeDominio("partidas", "La salida no tiene partidas.");
    for (const p of salida.partidas) {
      if (!p.articulo.activo) throw new ErrorDeDominio("catalogo", `${p.articulo.clave} está dado de baja.`);
      // La solicitud autorizada no se reinterpreta: se cancela y se vuelve a pedir.
      if (p.presentacionCapturada === "CAJA" && p.factorConversion !== p.articulo.piezasPorCaja) {
        throw new ErrorDeDominio(
          "factor-desactualizado",
          `${p.articulo.clave} pasó de ${p.factorConversion} a ${p.articulo.piezasPorCaja ?? "ninguna"} piezas por caja: cancela la salida y vuelve a solicitarla.`,
        );
      }
    }

    await asegurarYBloquearExistencias(tx, m.bodegaOrigenId, articuloIds);
    await bloquearCapasVivas(tx, m.bodegaOrigenId, articuloIds);
    await verificarExistencias(tx, id, m.bodegaOrigenId);

    const pedidas = salida.partidas.reduce((n, p) => n + p.cantidad, 0);
    const consumo = await consumirCapasPEPS(tx, id, m.bodegaOrigenId);
    const descontadas = await descontarExistencias(tx, id, m.bodegaOrigenId);
    if (
      consumo.piezas !== pedidas ||
      consumo.capas !== consumo.consumos ||
      descontadas !== articuloIds.length
    ) {
      throw new ErrorDeDominio("invariante", "El consumo de capas no cuadró con la salida; no se retiró nada.");
    }

    const folio = await tomarFolio(tx, "SALIDA");
    await transicionar(tx, id, "AUTORIZADA", {
      estatus: "RETIRADA",
      folio,
      fecha: aFechaDeBase(hoyEnMexico()),
      entregadoA: quien,
      entregadoPorId: usuario.id,
      entregadoEn: new Date(),
    });
    return { id, folio, repetido: false };
  } catch (error) {
    traducirErrorDeBase(error);
  }
}

// ──────────────────────────────── Recepción ──────────────────────────────────

/** RETIRADA → RECIBIDA: actor e instante, sin volver a tocar inventario. RECIBIDA es terminal. */
export async function confirmarRecepcion(tx: Tx, usuario: UsuarioSesion, id: string): Promise<ResultadoTransicion> {
  try {
    const m = await bloquearSalida(tx, id);
    if (m.estatus === "RECIBIDA") return { id, estatus: "RECIBIDA", repetido: true };
    if (m.estatus !== "RETIRADA") throw estadoInvalido(m, "confirmar la recepción");

    await transicionar(tx, id, "RETIRADA", { estatus: "RECIBIDA", recibidoPorId: usuario.id, recibidoEn: new Date() });
    return { id, estatus: "RECIBIDA", repetido: false };
  } catch (error) {
    traducirErrorDeBase(error);
  }
}
