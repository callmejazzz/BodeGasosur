import "server-only";
import type { Prisma } from "@prisma/client";
import type { UsuarioSesion } from "@/lib/db";
import { entradasRelacionadas, obtenerEntrada, type EntradaDetalle, type EntradaResumen } from "@/lib/entradas/repo";
import { TEXTO_ESTATUS_ENTRADA, TEXTO_ESTATUS_MOVIMIENTO } from "@/lib/estatus";
import { uuid } from "@/lib/movimientos/formulario";
import { datosDeDetalle as datosDeMovimiento, datosDeHoja, relacionesDeSalida } from "@/lib/inventario/pantallas";
import type { HojaDetalle, MovimientoDetalle, TipoInventario } from "@/lib/inventario/repo";
import type { SaldoDeArticulo } from "@/lib/inventario/primitivas";
import { datosDeDetalle as datosDeSalida } from "@/lib/salidas/pantallas";
import type { SalidaDetalle } from "@/lib/salidas/repo";
import { hoja, type Columna, type Hoja } from "./hoja";
import { completa } from "./lotes";
import type { Libro } from "./descargas";

/*
  Las tablas de consulta de cada detalle (contrato §4), una hoja por tabla y
  completas, no solo la página que se ve. Se leen con las mismas funciones que
  la pantalla, que ya validan el id y deciden qué ve cada quien.
*/

type Db = Prisma.TransactionClient;
type Params = Record<string, string | string[] | undefined>;

const idDe = (params: Params) => {
  const r = uuid.safeParse(params.id);
  return r.success ? r.data : null;
};
const decimal = (v: unknown) => (v === null || v === undefined ? null : String(v));
const presentacion = (p: { presentacionCapturada: string; factorConversion: number; articulo: { unidad: { clave: string } } }) =>
  p.presentacionCapturada === "CAJA" ? `Caja × ${p.factorConversion}` : p.articulo.unidad.clave;
const baja = (texto: string, activo: boolean) => (activo ? texto : `${texto} (dado de baja)`);

type Partida = { articulo: { clave: string; descripcion: string; activo: boolean; unidad: { clave: string } }; cantidadCapturada: number; presentacionCapturada: string; factorConversion: number; cantidad: number };

const partidaBase = <P extends Partida>(capturado = "Cantidad capturada"): Columna<P>[] => [
  { titulo: "Clave", formato: "texto", valor: (p) => p.articulo.clave },
  { titulo: "Descripción", formato: "texto", valor: (p) => baja(p.articulo.descripcion, p.articulo.activo) },
  { titulo: capturado, formato: "entero", valor: (p) => p.cantidadCapturada },
  { titulo: "Presentación", formato: "texto", valor: presentacion },
  { titulo: "Unidades base", formato: "entero", valor: (p) => p.cantidad },
  { titulo: "Unidad", formato: "texto", valor: (p) => p.articulo.unidad.clave },
];

// ──────────────────────────────── Entrada ────────────────────────────────────

export async function libroEntrada(db: Db, params: Params): Promise<Libro | null> {
  const id = idDe(params);
  const e = id && (await obtenerEntrada(db, id));
  if (!e) return null;
  const nombre = e.folio ? `Entrada ${e.folio}` : "Borrador de entrada";
  const m = e.moneda ?? "MXN";
  const filtros: [string, string][] = [["Entrada", nombre], ["Estatus", TEXTO_ESTATUS_ENTRADA[e.estatus]]];
  const hojas: Hoja<unknown>[] = [
    hoja<EntradaDetalle["partidas"][number]>({
      nombre: "Partidas",
      titulo: `Partidas de ${nombre.toLowerCase()}`,
      filtros,
      columnas: [
        ...partidaBase(),
        { titulo: `Costo capturado (${m})`, formato: "costo", valor: (p) => decimal(p.costoUnitarioCapturado) },
        { titulo: "IVA (%)", formato: "entero", valor: (p) => (p.tasaIva === null ? null : Math.round(Number(String(p.tasaIva)) * 100)) },
        { titulo: "Costo base (MXN)", formato: "costo", valor: (p) => decimal(p.costoUnitario) },
        { titulo: "Con IVA (MXN)", formato: "costo", valor: (p) => decimal(p.costoUnitarioConIva) },
        { titulo: "Serie / obs.", formato: "texto", valor: (p) => [p.numeroSerie, p.observaciones].filter(Boolean).join(" · ") },
      ],
      filas: completa(e.partidas),
    }),
  ];
  const relacionadas = await entradasRelacionadas(db, e);
  if (relacionadas.length > 0) {
    hojas.push(
      hoja<EntradaResumen>({
        nombre: "Misma factura",
        titulo: "Otras recepciones de la misma factura",
        filtros: [...filtros, ["Proveedor y referencia", `${e.proveedor?.nombreComercial ?? "—"} · ${e.referencia}`]],
        columnas: [
          { titulo: "Folio", formato: "texto", valor: (r) => r.folio ?? (r.estatus === "BORRADOR" ? "Borrador" : "Sin folio") },
          { titulo: "Fecha", formato: "fecha", valor: (r) => r.fecha },
          { titulo: "Partidas", formato: "entero", valor: (r) => r._count.partidas },
          { titulo: "Total", formato: "importe", valor: (r) => decimal(r.total) },
          { titulo: "Moneda", formato: "texto", valor: (r) => (r.total === null ? null : (r.moneda ?? "MXN")) },
          { titulo: "Estatus", formato: "texto", valor: (r) => TEXTO_ESTATUS_ENTRADA[r.estatus] },
        ],
        filas: completa(relacionadas),
      }),
    );
  }
  return { hojas, archivo: e.folio ? `entrada-${e.folio}` : "entrada-borrador" };
}

// ──────────────────────────────── Salida ─────────────────────────────────────

type Consumo = SalidaDetalle["partidas"][number]["consumos"][number] & { partida: SalidaDetalle["partidas"][number] };

export async function libroSalida(db: Db, usuario: UsuarioSesion, params: Params): Promise<Libro | null> {
  const d = await datosDeSalida(db, usuario, String(params.id ?? ""));
  if (!d) return null;
  const { salida: s, existencias } = d;
  const nombre = s.folio ? `Salida ${s.folio}` : "Salida sin folio";
  const filtros: [string, string][] = [["Salida", nombre]];
  const retirada = s.estatus === "RETIRADA" || s.estatus === "RECIBIDA";
  const hojas: Hoja<unknown>[] = [
    hoja<SalidaDetalle["partidas"][number]>({
      nombre: "Partidas",
      titulo: `Partidas de ${nombre.toLowerCase()}`,
      filtros,
      columnas: [
        ...partidaBase("Pedido"),
        // Solo para quien puede retirarla, como en pantalla.
        ...(existencias ? [{ titulo: "En bodega", formato: "entero", valor: (p) => existencias[p.articuloId] ?? 0 } satisfies Columna<SalidaDetalle["partidas"][number]>] : []),
        { titulo: "Observaciones", formato: "texto", valor: (p) => p.observaciones },
      ],
      filas: completa(s.partidas),
    }),
  ];
  if (retirada) {
    hojas.push(
      hoja<Consumo>({
        nombre: "Capas consumidas",
        titulo: "De qué capa salió cada pieza, en orden PEPS",
        filtros,
        columnas: [
          { titulo: "Clave", formato: "texto", valor: (c) => c.partida.articulo.clave },
          { titulo: "Cantidad", formato: "entero", valor: (c) => c.cantidad },
          { titulo: "Unidad", formato: "texto", valor: (c) => c.partida.articulo.unidad.clave },
          { titulo: "Fecha de la capa", formato: "fecha", valor: (c) => c.capa.fechaOriginal },
          { titulo: "Movimiento de la capa", formato: "texto", valor: (c) => c.capa.movimiento.folio },
          { titulo: "Costo", formato: "costo", valor: (c) => decimal(c.costoUnitario) },
          { titulo: "Costo con IVA", formato: "costo", valor: (c) => decimal(c.costoUnitarioConIva) },
        ],
        filas: completa(s.partidas.flatMap((partida) => partida.consumos.map((c) => ({ ...c, partida })))),
      }),
    );
  }
  const relaciones = await relacionesDeSalida(db, usuario, s);
  if (relaciones?.saldo) {
    hojas.push(
      hoja<SaldoDeArticulo>({
        nombre: s.esPrestamo ? "Préstamo" : "Devuelto",
        titulo: "Lo que volvió en devoluciones vigentes ligadas a la salida",
        filtros,
        columnas: [
          { titulo: "Clave", formato: "texto", valor: (a) => a.clave },
          { titulo: "Descripción", formato: "texto", valor: (a) => a.descripcion },
          { titulo: "Unidad", formato: "texto", valor: (a) => a.unidad },
          { titulo: "Salió", formato: "entero", valor: (a) => a.retirado },
          { titulo: "Volvió", formato: "entero", valor: (a) => a.devuelto },
          { titulo: "Falta", formato: "entero", valor: (a) => a.pendiente },
        ],
        filas: completa(relaciones.saldo),
      }),
      hoja<(typeof relaciones.devoluciones)[number]>({
        nombre: "Devoluciones",
        titulo: "Devoluciones de la salida",
        filtros,
        columnas: [
          { titulo: "Folio", formato: "texto", valor: (x) => x.folio ?? "Borrador" },
          { titulo: "Fecha", formato: "fecha", valor: (x) => x.fecha },
          { titulo: "Revertida", formato: "texto", valor: (x) => (x.canceladoPor ? `Con ${x.canceladoPor.folio}` : null) },
        ],
        filas: completa(relaciones.devoluciones),
      }),
    );
  }
  return { hojas, archivo: s.folio ? `salida-${s.folio}` : "salida-sin-folio" };
}

// ───────────────────── Traspaso, devolución o ajuste ─────────────────────────

const NOMBRE: Record<TipoInventario, [string, string]> = { TRASPASO: ["Traspaso", "traspaso"], DEVOLUCION: ["Devolución", "devolucion"], AJUSTE: ["Ajuste", "ajuste"] };

type Rastro = { clave: string; efecto: string; cantidad: number; unidad: string; fechaCapa: Date; bodega: string | null; folio: string | null; costo: string | null; costoConIva: string | null };

/** El rastro de capas de cada partida, como las líneas bajo ella en pantalla. */
function rastroDe(m: MovimientoDetalle): Rastro[] {
  return m.partidas.flatMap((p) => {
    const base = { clave: p.articulo.clave, unidad: p.articulo.unidad.clave };
    return [
      ...p.consumos.map((c) => ({ ...base, efecto: "Salió", cantidad: c.cantidad, fechaCapa: c.capa.fechaOriginal, bodega: c.capa.bodega.nombre, folio: c.capa.movimiento.folio, costo: decimal(c.costoUnitario), costoConIva: decimal(c.costoUnitarioConIva) })),
      ...m.capas
        .filter((c) => c.articuloId === p.articuloId)
        .map((c) => ({ ...base, efecto: "Entró", cantidad: c.cantidadInicial, fechaCapa: c.fechaOriginal, bodega: m.bodegaDestino?.nombre ?? null, folio: c.origen?.movimiento.folio ?? null, costo: decimal(c.costoUnitario), costoConIva: decimal(c.costoUnitarioConIva) })),
      ...p.restituciones.map((r) => ({ ...base, efecto: "Volvió", cantidad: r.cantidad, fechaCapa: r.capa.fechaOriginal, bodega: r.capa.bodega.nombre, folio: r.capa.movimiento.folio, costo: decimal(r.costoUnitario), costoConIva: decimal(r.costoUnitarioConIva) })),
    ];
  });
}

export async function libroMovimiento(db: Db, usuario: UsuarioSesion, tipo: TipoInventario, params: Params): Promise<Libro | null> {
  const d = await datosDeMovimiento(db, usuario, tipo, String(params.id ?? ""));
  if (!d) return null;
  const { movimiento: m, existencias, saldo } = d;
  const [nombreTipo, archivo] = NOMBRE[tipo];
  const nombre = m.folio ? `${nombreTipo} ${m.folio}` : `${nombreTipo} en borrador`;
  const filtros: [string, string][] = [[nombreTipo, nombre], ["Estatus", TEXTO_ESTATUS_MOVIMIENTO[m.estatus]]];
  const pendientes = saldo ? Object.fromEntries(saldo.map((s) => [s.articuloId, s.pendiente])) : null;
  type P = MovimientoDetalle["partidas"][number];
  const hojas: Hoja<unknown>[] = [
    hoja<P>({
      nombre: "Partidas",
      titulo: `Partidas de ${nombre.toLowerCase()}`,
      filtros,
      columnas: [
        ...partidaBase<P>(),
        ...(existencias ? [{ titulo: "En origen", formato: "entero", valor: (p) => existencias[p.articuloId] ?? 0 } satisfies Columna<P>] : []),
        ...(pendientes ? [{ titulo: "Falta por volver", formato: "entero", valor: (p) => pendientes[p.articuloId] ?? 0 } satisfies Columna<P>] : []),
        { titulo: "Observaciones", formato: "texto", valor: (p) => p.observaciones },
      ],
      filas: completa(m.partidas),
    }),
  ];
  const rastro = rastroDe(m);
  if (rastro.length > 0) {
    hojas.push(
      hoja<Rastro>({
        nombre: "Rastro de capas",
        titulo: "De qué capa salió, a cuál entró o a cuál volvió cada pieza",
        filtros,
        columnas: [
          { titulo: "Clave", formato: "texto", valor: (r) => r.clave },
          { titulo: "Efecto", formato: "texto", valor: (r) => r.efecto },
          { titulo: "Cantidad", formato: "entero", valor: (r) => r.cantidad },
          { titulo: "Unidad", formato: "texto", valor: (r) => r.unidad },
          { titulo: "Fecha de la capa", formato: "fecha", valor: (r) => r.fechaCapa },
          { titulo: "Bodega", formato: "texto", valor: (r) => r.bodega },
          { titulo: "Movimiento de origen", formato: "texto", valor: (r) => r.folio },
          { titulo: "Costo", formato: "costo", valor: (r) => r.costo },
          { titulo: "Costo con IVA", formato: "costo", valor: (r) => r.costoConIva },
        ],
        filas: completa(rastro),
      }),
    );
  }
  return { hojas, archivo: m.folio ? `${archivo}-${m.folio}` : `${archivo}-borrador` };
}

// ──────────────────────────────── Conteo ─────────────────────────────────────

export async function libroConteo(db: Db, usuario: UsuarioSesion, params: Params): Promise<Libro | null> {
  const d = await datosDeHoja(db, usuario, String(params.id ?? ""));
  if (!d) return null;
  const h = d.hoja;
  const filtros: [string, string][] = [["Bodega", `${h.bodega.clave} · ${h.bodega.nombre}`], ["Motivo", h.motivo], ["Estatus", TEXTO_ESTATUS_MOVIMIENTO[h.estatus]]];
  type R = HojaDetalle["renglones"][number];
  type A = HojaDetalle["ajustes"][number];
  return {
    archivo: `conteo-${h.bodega.clave}`,
    hojas: [
      hoja<R>({
        nombre: "Artículos",
        titulo: `Conteo de ${h.bodega.nombre}`,
        filtros,
        columnas: [
          { titulo: "Clave", formato: "texto", valor: (r) => r.articulo.clave },
          { titulo: "Descripción", formato: "texto", valor: (r) => baja(r.articulo.descripcion, r.articulo.activo) },
          { titulo: "Unidad", formato: "texto", valor: (r) => r.articulo.unidad.clave },
          { titulo: "Esperada", formato: "entero", valor: (r) => r.cantidadEsperada },
          { titulo: "Contada", formato: "entero", valor: (r) => r.cantidadContada },
          { titulo: "Diferencia", formato: "entero", valor: (r) => (r.cantidadContada === null ? null : r.cantidadContada - r.cantidadEsperada) },
          { titulo: "Observaciones", formato: "texto", valor: (r) => r.observaciones },
        ],
        filas: completa(h.renglones),
      }),
      hoja<A>({
        nombre: "Ajustes",
        titulo: "Ajustes que generó la hoja",
        filtros,
        columnas: [
          { titulo: "Folio", formato: "texto", valor: (a) => a.folio },
          { titulo: "Efecto", formato: "texto", valor: (a) => (a.bodegaDestinoId ? "Suma" : "Resta") },
          { titulo: "Artículos", formato: "entero", valor: (a) => a._count.partidas },
          { titulo: "Revertido con", formato: "texto", valor: (a) => a.canceladoPor?.folio },
        ],
        filas: completa(h.ajustes),
      }),
    ],
  };
}
