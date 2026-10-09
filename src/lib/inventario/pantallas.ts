import "server-only";
import type { EstatusMovimiento, Prisma, TipoMovimiento } from "@prisma/client";
import { z } from "zod";
import { uuid } from "@/lib/movimientos/formulario";
import { acotarPagina, leerPagina, type Pagina } from "@/lib/paginacion";
import { usuarioTienePermiso, type Permiso, type SujetoDePermisos } from "@/lib/permisos";
import { estatusDeFiltro, leerFiltros, leerFiltrosDeHojas } from "./filtros";
import { saldoDeSalida, type SaldoDeArticulo } from "./primitivas";
import {
  devolucionesDe,
  existenciasPorBodega,
  listarHojas,
  listarMovimientos,
  obtenerHoja,
  obtenerMovimiento,
  opcionesDeArticulos,
  opcionesDeBodegas,
  opcionesDeEstaciones,
  listarSalidasDevolvibles,
  reversaDe,
  salidaParaDevolver,
  valuarMovimiento,
  type EstadoDevolucion,
  type MovimientoDetalle,
  type SalidaConsultada,
  type SalidaDevolvible,
  type TipoInventario,
} from "./repo";

// Lo que lee cada pantalla de la fase 7. Corre dentro de consultar(), que ya
// comprobó sesión y permiso de lectura. Lo que el usuario no puede ver ni usar
// no se consulta: sin permiso de captura no se cargan catálogos ni
// existencias, y sin el de reversa no se prepara nada para revertir.

type Db = Prisma.TransactionClient;
type Params = Record<string, string | string[] | undefined>;

export const PERMISOS_DE: Record<TipoInventario, { leer: Permiso; capturar: Permiso | null; confirmar: Permiso | null }> = {
  TRASPASO: { leer: "traspasos:leer", capturar: "traspasos:capturar", confirmar: "traspasos:confirmar" },
  DEVOLUCION: { leer: "devoluciones:leer", capturar: "devoluciones:capturar", confirmar: "devoluciones:confirmar" },
  // Los ajustes nacen de una hoja de conteo o de una reversa: no se capturan sueltos.
  AJUSTE: { leer: "ajustes:leer", capturar: null, confirmar: null },
};

const puede = (usuario: SujetoDePermisos, permiso: Permiso | null) => permiso !== null && usuarioTienePermiso(usuario, permiso);

export async function datosDeLista(db: Db, usuario: SujetoDePermisos, tipo: TipoInventario, params: Params) {
  const filtros = leerFiltros(params);
  const lista = await listarMovimientos(db, tipo, { estatus: estatusDeFiltro(filtros), busqueda: filtros.busqueda }, leerPagina(params.pagina));
  return { filtros, ...lista, puedeCapturar: puede(usuario, PERMISOS_DE[tipo].capturar) };
}

/** Un efecto confirmado —o una salida retirada— es lo único que se revierte. */
export const afectoInventario = (tipo: TipoMovimiento, estatus: EstatusMovimiento) =>
  tipo === "SALIDA" ? estatus === "RETIRADA" || estatus === "RECIBIDA" : estatus === "CONFIRMADO";

/** La reversa de un movimiento y si quien mira puede hacerla. Solo se prepara para el Superadmin. */
export async function datosDeReversa(db: Db, usuario: SujetoDePermisos, m: { id: string; tipo: TipoMovimiento; estatus: EstatusMovimiento; cancelaAId: string | null }) {
  const reversa = await reversaDe(db, m.id);
  const revertir = !reversa && !m.cancelaAId && afectoInventario(m.tipo, m.estatus) && usuarioTienePermiso(usuario, "movimientos:revertir");
  return { reversa, revertir };
}

export async function datosDeDetalle(db: Db, usuario: SujetoDePermisos, tipo: TipoInventario, idCrudo: string) {
  const id = uuid.safeParse(idCrudo);
  if (!id.success) return null;
  const movimiento = await obtenerMovimiento(db, tipo, id.data);
  if (!movimiento) return null;

  const borrador = movimiento.estatus === "BORRADOR" && !movimiento.cancelaA;
  const facultades = {
    editar: borrador && puede(usuario, PERMISOS_DE[tipo].capturar),
    confirmar: borrador && puede(usuario, PERMISOS_DE[tipo].confirmar),
  };
  const { reversa, revertir } = await datosDeReversa(db, usuario, { id: movimiento.id, tipo, estatus: movimiento.estatus, cancelaAId: movimiento.cancelaA?.id ?? null });
  const articuloIds = movimiento.partidas.map((p) => p.articuloId);

  return {
    movimiento,
    puede: { ...facultades, revertir },
    reversa,
    valuacion: movimiento.estatus === "CONFIRMADO" ? await valuarMovimiento(db, movimiento.id) : null,
    // Solo para quien puede editar el borrador, y solo mientras lo es.
    opciones: facultades.editar ? await opcionesDeCaptura(db, tipo, articuloIds) : null,
    vinculada: facultades.editar ? await salidaDelBorrador(db, movimiento) : null,
    // Lo que hay en origen, para quien va a confirmar un traspaso: se vuelve a comprobar bajo candado.
    existencias:
      facultades.confirmar && tipo === "TRASPASO" && movimiento.bodegaOrigenId
        ? ((await existenciasPorBodega(db))[movimiento.bodegaOrigenId] ?? {})
        : null,
    // Lo que falta por volver de la salida vinculada, para quien edita o confirma.
    saldo: (facultades.editar || facultades.confirmar) && movimiento.devuelveA ? await saldoDeSalida(db, movimiento.devuelveA.id) : null,
  };
}

export type OpcionesCaptura = Awaited<ReturnType<typeof opcionesDeCaptura>>;

/** Catálogos para capturar: bodegas y artículos; estaciones solo para devoluciones. Las salidas se piden una a una. */
export async function opcionesDeCaptura(db: Db, tipo: TipoInventario, articulosDelBorrador: readonly string[] = []) {
  return {
    bodegas: await opcionesDeBodegas(db),
    articulos: await opcionesDeArticulos(db, articulosDelBorrador),
    existencias: tipo === "TRASPASO" ? await existenciasPorBodega(db) : {},
    estaciones: tipo === "DEVOLUCION" ? await opcionesDeEstaciones(db) : [],
  };
}

// ─────────────────────── Salida de una devolución ────────────────────────────

/** La salida que el formulario vincula y, si no admite devolución, por qué. */
export type SalidaDelFormulario = { salida: SalidaDevolvible | null; aviso: string | null };

const aFormulario = (r: SalidaConsultada): SalidaDelFormulario => ({ salida: r.salida ?? null, aviso: r.motivo ?? null });

/** La salida del enlace (?salida=…), consultada y validada; sin parámetro, ninguna. */
export async function salidaDelEnlace(db: Db, crudo: unknown): Promise<SalidaDelFormulario> {
  if (crudo === undefined) return { salida: null, aviso: null };
  const id = uuid.safeParse(crudo);
  if (!id.success) return { salida: null, aviso: "El enlace no trae una salida válida." };
  return aFormulario(await salidaParaDevolver(db, { id: id.data }));
}

/** Una página del selector de salidas: lo que la persona tecleó, en la estación que eligió. */
export type PaginaDeSalidas = { salidas: SalidaDevolvible[]; pagina: Pagina; aviso: string | null };

const busquedaDeSalidas = z.object({
  estacionId: uuid,
  texto: z.string().trim().max(40).regex(/^[\p{L}\p{N} .·-]*$/u),
  pagina: z.number().int().min(1).max(999_999),
});

/**
 * El selector de salidas de una devolución, con búsqueda por teclado. Si
 * nada coincide y lo tecleado es el folio de una salida, dice por qué no
 * aparece: ya volvió todo, fue revertida o salió a otra estación.
 */
export async function salidasDelSelector(db: Db, crudo: unknown): Promise<PaginaDeSalidas> {
  const b = busquedaDeSalidas.safeParse(crudo);
  if (!b.success) return { salidas: [], pagina: acotarPagina(1, 0), aviso: "Elige la estación y busca por folio, número o nombre." };
  const { filas, pagina } = await listarSalidasDevolvibles(db, { estacionId: b.data.estacionId, texto: b.data.texto }, b.data.pagina);
  if (filas.length > 0 || !/^[A-Za-z]{0,2}-?\d+$/.test(b.data.texto)) return { salidas: filas, pagina, aviso: null };
  const r = await salidaParaDevolver(db, { folio: b.data.texto });
  const aviso = r.salida
    ? r.salida.estacion.id === b.data.estacionId ? null : `La salida ${r.salida.folio} salió a ${r.salida.estacion.nombre}.`
    : r.motivo;
  return { salidas: [], pagina, aviso };
}

/**
 * La salida del borrador se conserva aunque ya no admita devolución: si el
 * formulario la soltara, guardar la desvincularía sin que nadie lo pidiera.
 * El aviso explica por qué ya no se podrá confirmar así.
 */
async function salidaDelBorrador(db: Db, m: MovimientoDetalle): Promise<SalidaDelFormulario | null> {
  const s = m.devuelveA;
  if (!s) return null;
  const r = await salidaParaDevolver(db, { id: s.id });
  if (r.salida || !s.bodegaOrigen || !m.estacionId || !m.estacion) return aFormulario(r);
  return {
    salida: {
      id: s.id,
      folio: s.folio ?? "",
      esPrestamo: s.esPrestamo,
      estacion: { id: m.estacionId, nombre: `${m.estacion.numero} · ${m.estacion.alias}` },
      bodega: { id: s.bodegaOrigen.id, nombre: `${s.bodegaOrigen.clave} · ${s.bodegaOrigen.nombre}` },
      pendientes: {},
    },
    aviso: r.motivo,
  };
}

// ─────────────────────────────── Conteos ─────────────────────────────────────

export async function datosDeListaHojas(db: Db, usuario: SujetoDePermisos, params: Params) {
  const filtros = leerFiltrosDeHojas(params);
  const lista = await listarHojas(db, { estatus: estatusDeFiltro(filtros), desde: filtros.desde, hasta: filtros.hasta }, leerPagina(params.pagina));
  return { filtros, ...lista, puedeCapturar: usuarioTienePermiso(usuario, "ajustes:capturar") };
}

export async function datosDeHoja(db: Db, usuario: SujetoDePermisos, idCrudo: string) {
  const id = uuid.safeParse(idCrudo);
  if (!id.success) return null;
  const hoja = await obtenerHoja(db, id.data);
  if (!hoja) return null;
  const borrador = hoja.estatus === "BORRADOR";
  const puedeHoja = { capturar: borrador && usuarioTienePermiso(usuario, "ajustes:capturar"), confirmar: borrador && usuarioTienePermiso(usuario, "ajustes:confirmar") };
  return {
    hoja,
    puede: puedeHoja,
    // El catálogo para agregar artículos, solo a quien puede capturar en esta hoja.
    articulos: puedeHoja.capturar ? await opcionesDeArticulos(db) : null,
  };
}

// ──────────────────────── Entradas y salidas cerradas ────────────────────────

/**
 * Lo que la fase 7 agrega al detalle de una salida retirada o recibida: su
 * reversa, lo que ha vuelto y lo que falta. Sin permiso de leer devoluciones
 * no se consultan.
 */
const estadoDeDevolucion = (saldo: SaldoDeArticulo[]): EstadoDevolucion | null =>
  !saldo.some((a) => a.devuelto > 0) ? null : saldo.every((a) => a.pendiente === 0) ? "completa" : "parcial";

export async function relacionesDeSalida(db: Db, usuario: SujetoDePermisos, s: { id: string; estatus: EstatusMovimiento }) {
  if (!afectoInventario("SALIDA", s.estatus)) return null;
  const { reversa, revertir } = await datosDeReversa(db, usuario, { id: s.id, tipo: "SALIDA", estatus: s.estatus, cancelaAId: null });
  const leeDevoluciones = usuarioTienePermiso(usuario, "devoluciones:leer");
  const saldo = leeDevoluciones ? await saldoDeSalida(db, s.id) : null;
  return {
    reversa,
    revertir,
    devoluciones: leeDevoluciones ? await devolucionesDe(db, s.id) : [],
    saldo,
    devolucion: saldo && estadoDeDevolucion(saldo),
    puedeDevolver: !reversa && usuarioTienePermiso(usuario, "devoluciones:capturar"),
  };
}
