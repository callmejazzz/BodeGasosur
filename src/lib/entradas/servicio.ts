import { Prisma, type Moneda, type Presentacion } from "@prisma/client";
import type { UsuarioSesion } from "@/lib/db";
import { deFechaDeBase, aFechaDeBase, hoyEnMexico, motivoFechaNoOperativa } from "@/lib/fechas";
import { ErrorDeDominio, traducirErrorDeBase } from "./errores";
import {
  asegurarYBloquearExistencias,
  bloquearArticulos,
  bloquearContrapartes,
  calcularCostosBase,
  crearCapasDeEntrada,
  incrementarExistencias,
  recalcularCostosYTotales,
  tomarFolio,
  verificarCapacidadDeExistencias,
} from "./primitivas";

/*
  Todo lo que viene del navegador se vuelve a validar aquí: el factor de
  conversión y los costos canónicos no se aceptan, se derivan (11 §5, §6).
*/

type Tx = Prisma.TransactionClient;

export type PartidaCapturada = {
  articuloId: string;
  presentacion: Presentacion;
  cantidadCapturada: number;
  /** Sin IVA, por la presentación elegida, en la moneda de la factura. */
  costoUnitarioCapturado: string;
  tasaIva: string;
  numeroSerie?: string | null;
  observaciones?: string | null;
};

export type EncabezadoCapturado = {
  proveedorId: string;
  bodegaDestinoId: string;
  /** AAAA-MM-DD */
  fecha: string;
  moneda: Moneda;
  /** Pesos por dólar; se ignora en MXN. */
  tipoCambio?: string | null;
  referencia?: string | null;
  observaciones?: string | null;
};

export type DatosBorrador = { encabezado: EncabezadoCapturado; partidas: PartidaCapturada[] };

const DECIMAL_4 = /^\d{1,10}(\.\d{1,4})?$/;
const TIPO_CAMBIO = /^\d{1,8}(\.\d{1,6})?$/;
const TASA_IVA = /^(0(\.\d{1,4})?|1(\.0{1,4})?)$/;

// ─────────────────────────────── Validación ──────────────────────────────────

type PartidaNormalizada = PartidaCapturada & { factorConversion: number; cantidad: number };
type DatosNormalizados = {
  encabezado: Required<EncabezadoCapturado>;
  partidas: PartidaNormalizada[];
};

async function normalizar(tx: Tx, datos: DatosBorrador, hoy = hoyEnMexico()): Promise<DatosNormalizados> {
  const { encabezado: e, partidas } = datos;

  const motivo = motivoFechaNoOperativa(e.fecha, hoy);
  if (motivo === "invalida") throw new ErrorDeDominio("fecha", "La fecha no es un día válido (AAAA-MM-DD).");
  if (motivo === "anterior-a-minima") throw new ErrorDeDominio("fecha", "La fecha es anterior al inicio de operación.");
  if (motivo === "futura") throw new ErrorDeDominio("fecha", "La fecha no puede ser posterior a hoy.");

  let tipoCambio: string | null = null;
  if (e.moneda === "USD") {
    const tc = e.tipoCambio?.trim() ?? "";
    if (!TIPO_CAMBIO.test(tc) || Number(tc) <= 0) {
      throw new ErrorDeDominio("moneda", "Una factura en dólares necesita el tipo de cambio en pesos por dólar.");
    }
    tipoCambio = tc;
  } else if (e.moneda !== "MXN") {
    throw new ErrorDeDominio("moneda", "La moneda tiene que ser MXN o USD.");
  }

  // Secuencial a propósito: dentro de una transacción hay una sola conexión.
  const proveedor = await tx.proveedor.findUnique({ where: { id: e.proveedorId }, select: { activo: true } });
  const bodega = await tx.bodega.findUnique({ where: { id: e.bodegaDestinoId }, select: { activa: true } });
  if (!proveedor?.activo) throw new ErrorDeDominio("catalogo", "El proveedor no existe o está dado de baja.");
  if (!bodega?.activa) throw new ErrorDeDominio("catalogo", "La bodega destino no existe o está dada de baja.");

  const ids = partidas.map((p) => p.articuloId);
  if (new Set(ids).size !== ids.length) {
    throw new ErrorDeDominio("partidas", "Un artículo no puede aparecer dos veces en la misma entrada.");
  }
  const articulos = new Map(
    (
      await tx.articulo.findMany({
        where: { id: { in: ids } },
        select: { id: true, clave: true, activo: true, piezasPorCaja: true },
      })
    ).map((a) => [a.id, a]),
  );

  const normalizadas = partidas.map((p): PartidaNormalizada => {
    const articulo = articulos.get(p.articuloId);
    if (!articulo?.activo) throw new ErrorDeDominio("catalogo", "Un artículo de la entrada no existe o está dado de baja.");
    if (!Number.isInteger(p.cantidadCapturada) || p.cantidadCapturada <= 0) {
      throw new ErrorDeDominio("partidas", `${articulo.clave}: la cantidad tiene que ser un entero positivo.`);
    }
    if (!DECIMAL_4.test(p.costoUnitarioCapturado)) {
      throw new ErrorDeDominio("partidas", `${articulo.clave}: el costo unitario no es válido (hasta cuatro decimales).`);
    }
    if (!TASA_IVA.test(p.tasaIva)) {
      throw new ErrorDeDominio("partidas", `${articulo.clave}: la tasa de IVA va de 0 a 1 (0.16 para 16 %).`);
    }

    // El factor sale del catálogo, nunca del navegador (11 §5).
    let factorConversion = 1;
    if (p.presentacion === "CAJA") {
      if (!articulo.piezasPorCaja) {
        throw new ErrorDeDominio("partidas", `${articulo.clave} no se maneja por caja: captúralo en su unidad.`);
      }
      factorConversion = articulo.piezasPorCaja;
    } else if (p.presentacion !== "UNIDAD") {
      throw new ErrorDeDominio("partidas", `${articulo.clave}: la presentación tiene que ser UNIDAD o CAJA.`);
    }

    const cantidad = p.cantidadCapturada * factorConversion;
    if (cantidad > 2_147_483_647) {
      throw new ErrorDeDominio("partidas", `${articulo.clave}: la cantidad en unidades base es demasiado grande.`);
    }
    return { ...p, factorConversion, cantidad };
  });

  return {
    encabezado: {
      proveedorId: e.proveedorId,
      bodegaDestinoId: e.bodegaDestinoId,
      fecha: e.fecha,
      moneda: e.moneda,
      tipoCambio,
      referencia: e.referencia?.trim() || null,
      observaciones: e.observaciones?.trim() || null,
    },
    partidas: normalizadas,
  };
}

async function partidasParaGuardar(tx: Tx, datos: DatosNormalizados) {
  const costos = await calcularCostosBase(tx, datos.encabezado.tipoCambio, datos.partidas);
  return datos.partidas.map((p, i) => ({
    orden: i + 1,
    articuloId: p.articuloId,
    presentacionCapturada: p.presentacion,
    cantidadCapturada: p.cantidadCapturada,
    factorConversion: p.factorConversion,
    cantidad: p.cantidad,
    costoUnitarioCapturado: p.costoUnitarioCapturado,
    tasaIva: p.tasaIva,
    costoUnitario: costos[i].costoUnitario,
    costoUnitarioConIva: costos[i].costoUnitarioConIva,
    numeroSerie: p.numeroSerie?.trim() || null,
    observaciones: p.observaciones?.trim() || null,
  }));
}

// ────────────────────────────── Encabezado ───────────────────────────────────

type Encabezado = {
  id: string;
  tipo: string;
  estatus: string;
  folio: string | null;
  proveedorId: string | null;
  bodegaDestinoId: string | null;
  fecha: Date;
};

/** Toma el candado del encabezado —el mismo que toman las partidas— y lo lee. */
async function bloquearEntrada(tx: Tx, id: string): Promise<Encabezado> {
  const filas = await tx.$queryRaw<Encabezado[]>`
    SELECT id, tipo::text, estatus::text, folio, "proveedorId", "bodegaDestinoId", fecha
    FROM "Movimiento" WHERE id = ${id}::uuid FOR UPDATE`;
  const m = filas[0];
  if (!m) throw new ErrorDeDominio("no-encontrado", "La entrada no existe.");
  if (m.tipo !== "ENTRADA") throw new ErrorDeDominio("no-es-entrada", "El movimiento no es una entrada.");
  return m;
}

function exigirBorrador(m: Encabezado) {
  if (m.estatus === "CONFIRMADO") {
    throw new ErrorDeDominio("ya-confirmado", `La entrada ${m.folio} ya está confirmada y no se edita.`);
  }
  if (m.estatus !== "BORRADOR") throw new ErrorDeDominio("cancelado", "La entrada fue descartada.");
}

// ────────────────────────────── Borradores ───────────────────────────────────

function chocaCon(error: unknown, columna: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const meta = error.meta as
    | { target?: string[]; driverAdapterError?: { cause?: { constraint?: { fields?: string[] } } } }
    | undefined;
  const campos = meta?.driverAdapterError?.cause?.constraint?.fields ?? meta?.target ?? [];
  return campos.some((c) => c.replaceAll('"', "") === columna);
}

export type ResultadoAlta = { id: string; repetido: boolean };

/**
 * Crea el borrador. La llave de idempotencia viene del formulario y es única
 * en la base (11 §8). Primero se busca la llave: si ya hay borrador con la
 * misma captura, se devuelve sin volver a validar catálogos —un reintento
 * después de que se dio de baja un artículo sigue encontrando su borrador—.
 * Si no hay, se valida e inserta; la restricción única y el savepoint cubren
 * la carrera entre dos solicitudes que llegan a la vez.
 */
export async function crearBorrador(
  tx: Tx,
  usuario: UsuarioSesion,
  llaveIdempotencia: string,
  datos: DatosBorrador,
): Promise<ResultadoAlta> {
  try {
    const previo = await resolverRepeticion(tx, usuario, llaveIdempotencia, datos);
    if (previo) return { id: previo, repetido: true };

    const normalizados = await normalizar(tx, datos);
    const partidas = await partidasParaGuardar(tx, normalizados);
    const { encabezado: e } = normalizados;

    // Si la llave choca, PostgreSQL deja la transacción abortada; el savepoint
    // permite retroceder solo el INSERT y seguir leyendo el borrador que ya está.
    await tx.$executeRawUnsafe("SAVEPOINT alta_borrador");
    let creado: { id: string };
    try {
      creado = await tx.movimiento.create({
        data: {
          tipo: "ENTRADA",
          estatus: "BORRADOR",
          llaveIdempotencia,
          fecha: aFechaDeBase(e.fecha),
          moneda: e.moneda,
          tipoCambio: e.tipoCambio,
          proveedorId: e.proveedorId,
          bodegaDestinoId: e.bodegaDestinoId,
          referencia: e.referencia,
          observaciones: e.observaciones,
          creadoPorId: usuario.id,
          partidas: { create: partidas },
        },
        select: { id: true },
      });
    } catch (error) {
      if (!chocaCon(error, "llaveIdempotencia")) throw error;
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT alta_borrador");
      const ganador = await resolverRepeticion(tx, usuario, llaveIdempotencia, datos);
      if (!ganador) throw new ErrorDeDominio("concurrencia", "La captura se cruzó con otra; inténtalo de nuevo.");
      return { id: ganador, repetido: true };
    }
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT alta_borrador");

    await recalcularCostosYTotales(tx, creado.id);
    return { id: creado.id, repetido: false };
  } catch (error) {
    traducirErrorDeBase(error);
  }
}

/**
 * Busca la llave. Nulo si no hay borrador; su id si la captura es la misma;
 * conflicto si la llave es de otro usuario, de otro tipo o trae otros datos.
 * La llave no concede acceso.
 */
async function resolverRepeticion(
  tx: Tx,
  usuario: UsuarioSesion,
  llaveIdempotencia: string,
  datos: DatosBorrador,
): Promise<string | null> {
  const existente = await tx.movimiento.findUnique({
    where: { llaveIdempotencia },
    include: { partidas: true },
  });
  if (!existente) return null;

  const conflicto = () =>
    new ErrorDeDominio("conflicto-idempotencia", "Esta captura ya se envió con otros datos. Abre la entrada guardada.");
  if (existente.tipo !== "ENTRADA" || existente.creadoPorId !== usuario.id) throw conflicto();
  if (firmaDeCaptura(datos) !== firmaDeGuardado(existente)) throw conflicto();
  return existente.id;
}

// ── Representación canónica de la captura ─────────────────────────────────
//
// Solo lo que la persona escribió; nada derivado (factor, cantidad base,
// costos canónicos, totales). Objetos con claves fijas, partidas ordenadas y
// JSON.stringify: sin separadores que un texto libre pudiera imitar.

const texto = (v: string | null | undefined) => (v ?? "").trim();
const decimal = (v: unknown) => {
  try {
    return new Prisma.Decimal(String(v ?? "").trim()).toString();
  } catch {
    return `?${String(v ?? "")}`;
  }
};

type PartidaCanonica = {
  articuloId: string;
  presentacion: string;
  cantidadCapturada: number;
  costoUnitarioCapturado: string;
  tasaIva: string;
  numeroSerie: string;
  observaciones: string;
};

type CapturaCanonica = {
  proveedorId: string;
  bodegaDestinoId: string;
  fecha: string;
  moneda: string;
  tipoCambio: string;
  referencia: string;
  observaciones: string;
  partidas: PartidaCanonica[];
};

function partidaCanonica(p: {
  articuloId: string;
  presentacion: string;
  cantidadCapturada: number;
  costoUnitarioCapturado: unknown;
  tasaIva: unknown;
  numeroSerie?: string | null;
  observaciones?: string | null;
}): PartidaCanonica {
  return {
    articuloId: p.articuloId,
    presentacion: p.presentacion,
    cantidadCapturada: p.cantidadCapturada,
    costoUnitarioCapturado: decimal(p.costoUnitarioCapturado),
    tasaIva: decimal(p.tasaIva),
    numeroSerie: texto(p.numeroSerie),
    observaciones: texto(p.observaciones),
  };
}

function firma(c: CapturaCanonica): string {
  const partidas = [...c.partidas].sort((a, b) => {
    const ka = JSON.stringify(a);
    const kb = JSON.stringify(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return JSON.stringify({ ...c, partidas });
}

function firmaDeCaptura(d: DatosBorrador): string {
  const e = d.encabezado;
  return firma({
    proveedorId: e.proveedorId,
    bodegaDestinoId: e.bodegaDestinoId,
    fecha: e.fecha,
    moneda: e.moneda,
    tipoCambio: e.moneda === "USD" ? decimal(e.tipoCambio) : "",
    referencia: texto(e.referencia),
    observaciones: texto(e.observaciones),
    partidas: d.partidas.map(partidaCanonica),
  });
}

function firmaDeGuardado(m: {
  proveedorId: string | null;
  bodegaDestinoId: string | null;
  fecha: Date;
  moneda: string | null;
  tipoCambio: unknown;
  referencia: string | null;
  observaciones: string | null;
  partidas: (Omit<Parameters<typeof partidaCanonica>[0], "presentacion"> & { presentacionCapturada: string })[];
}): string {
  return firma({
    proveedorId: m.proveedorId ?? "",
    bodegaDestinoId: m.bodegaDestinoId ?? "",
    fecha: deFechaDeBase(m.fecha),
    moneda: m.moneda ?? "",
    tipoCambio: m.moneda === "USD" ? decimal(m.tipoCambio) : "",
    referencia: texto(m.referencia),
    observaciones: texto(m.observaciones),
    partidas: m.partidas.map((p) => partidaCanonica({ ...p, presentacion: p.presentacionCapturada })),
  });
}

/** Reemplaza encabezado y partidas de un borrador. Toma el candado del encabezado. */
export async function guardarBorrador(tx: Tx, usuario: UsuarioSesion, id: string, datos: DatosBorrador): Promise<void> {
  try {
    const m = await bloquearEntrada(tx, id);
    exigirBorrador(m);
    const normalizados = await normalizar(tx, datos);
    const partidas = await partidasParaGuardar(tx, normalizados);
    const { encabezado: e } = normalizados;

    await tx.movimientoPartida.deleteMany({ where: { movimientoId: id } });
    await tx.movimiento.update({
      where: { id },
      data: {
        fecha: aFechaDeBase(e.fecha),
        moneda: e.moneda,
        tipoCambio: e.tipoCambio,
        proveedorId: e.proveedorId,
        bodegaDestinoId: e.bodegaDestinoId,
        referencia: e.referencia,
        observaciones: e.observaciones,
        partidas: { create: partidas },
      },
      select: { id: true },
    });
    await recalcularCostosYTotales(tx, id);
  } catch (error) {
    traducirErrorDeBase(error);
  }
}

/** BORRADOR → CANCELADO (11 §4, «descartar»). */
export async function descartarBorrador(tx: Tx, usuario: UsuarioSesion, id: string, motivo: string): Promise<void> {
  try {
    const m = await bloquearEntrada(tx, id);
    exigirBorrador(m);
    const texto = motivo.trim();
    if (!texto) throw new ErrorDeDominio("partidas", "Di por qué se descarta el borrador.");
    await tx.movimiento.update({
      where: { id },
      data: { estatus: "CANCELADO", motivoCancelacion: texto, canceladoPorId: usuario.id, canceladoEn: new Date() },
      select: { id: true },
    });
  } catch (error) {
    traducirErrorDeBase(error);
  }
}

// ─────────────────────────────── Confirmación ────────────────────────────────

export type ResultadoConfirmacion = { id: string; folio: string; repetido: boolean };

/**
 * BORRADOR → CONFIRMADO en una sola transacción (11 §9). El reclamo principal
 * es el FOR UPDATE del encabezado: solo quien lo tiene lee el estatus y
 * decide; quien llega después lo encuentra ya confirmado y recibe el mismo
 * folio. Orden de bloqueo: encabezado → proveedor → bodega → artículos (todos
 * FOR SHARE) → existencias → folio. El catálogo se lee después de tener sus
 * candados, para que lo validado sea lo que se confirma.
 */
export async function confirmarEntrada(tx: Tx, usuario: UsuarioSesion, id: string): Promise<ResultadoConfirmacion> {
  try {
    const m = await bloquearEntrada(tx, id);
    if (m.estatus === "CONFIRMADO") return { id, folio: m.folio!, repetido: true };
    exigirBorrador(m);

    await bloquearContrapartes(tx, m.proveedorId!, m.bodegaDestinoId!);
    const articuloIds = (
      await tx.movimientoPartida.findMany({ where: { movimientoId: id }, select: { articuloId: true } })
    ).map((p) => p.articuloId);
    await bloquearArticulos(tx, articuloIds);

    const encabezado = await tx.movimiento.findUniqueOrThrow({
      where: { id },
      select: {
        proveedor: { select: { activo: true } },
        bodegaDestino: { select: { activa: true } },
        partidas: {
          select: {
            presentacionCapturada: true,
            factorConversion: true,
            costoUnitarioCapturado: true,
            tasaIva: true,
            articulo: { select: { id: true, clave: true, activo: true, piezasPorCaja: true } },
          },
        },
      },
    });

    if (motivoFechaNoOperativa(deFechaDeBase(m.fecha)) !== null) {
      throw new ErrorDeDominio("fecha", "La fecha de la entrada ya no es válida; corrígela antes de confirmar.");
    }
    if (!encabezado.proveedor?.activo) throw new ErrorDeDominio("catalogo", "El proveedor está dado de baja.");
    if (!encabezado.bodegaDestino?.activa) throw new ErrorDeDominio("catalogo", "La bodega destino está dada de baja.");
    if (encabezado.partidas.length === 0) throw new ErrorDeDominio("partidas", "La entrada no tiene partidas.");

    for (const p of encabezado.partidas) {
      if (!p.articulo.activo) throw new ErrorDeDominio("catalogo", `${p.articulo.clave} está dado de baja.`);
      if (p.costoUnitarioCapturado === null || p.tasaIva === null) {
        throw new ErrorDeDominio("partidas", `${p.articulo.clave}: falta el costo o la tasa de IVA.`);
      }
      // Fotografía vs. catálogo: si cambió, se vuelve a guardar (11 §5).
      if (p.presentacionCapturada === "CAJA" && p.factorConversion !== p.articulo.piezasPorCaja) {
        throw new ErrorDeDominio(
          "factor-desactualizado",
          `${p.articulo.clave} pasó de ${p.factorConversion} a ${p.articulo.piezasPorCaja ?? "ninguna"} piezas por caja: vuelve a guardar esa partida.`,
        );
      }
    }

    await recalcularCostosYTotales(tx, id);
    await asegurarYBloquearExistencias(
      tx,
      m.bodegaDestinoId!,
      encabezado.partidas.map((p) => p.articulo.id),
    );
    await verificarCapacidadDeExistencias(tx, id, m.bodegaDestinoId!);
    const folio = await tomarFolio(tx, "ENTRADA");
    await crearCapasDeEntrada(tx, id);
    await incrementarExistencias(tx, id, m.bodegaDestinoId!);

    // Defensa adicional al candado: con el encabezado tomado siempre afecta
    // una fila; si no, alguien escribió sin el orden de bloqueo y se aborta todo.
    const { count } = await tx.movimiento.updateMany({
      where: { id, estatus: "BORRADOR" },
      data: { estatus: "CONFIRMADO", folio, confirmadoPorId: usuario.id, confirmadoEn: new Date() },
    });
    if (count !== 1) throw new ErrorDeDominio("concurrencia", "La entrada cambió mientras se confirmaba; vuelve a intentarlo.");

    return { id, folio, repetido: false };
  } catch (error) {
    traducirErrorDeBase(error);
  }
}
