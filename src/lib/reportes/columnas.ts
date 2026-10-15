import type { Columna } from "@/lib/exportar/hoja";
import { rutaDeMovimiento } from "@/lib/inventario/repo";
import type { FilaExistencia } from "./existencias";
import type { FilaFrecuencia } from "./frecuencia";
import type { FilaGastoDetalle, FilaGastoEstacion } from "./gasto";
import type { FilaKardex, ResumenBodega } from "./kardex";
import type { FilaSemanal, Movimientos, TotalArticulo } from "./semanal";

// Las columnas de cada reporte, una sola vez: la pantalla y el Excel las leen
// de aquí, así que no pueden diferir.

const baja = (texto: string, activo: boolean, femenino = false) => (activo ? texto : `${texto} (dad${femenino ? "a" : "o"} de baja)`);

const kardexDe = (articuloId: string, desde: string, hasta: string, bodegaId?: string) =>
  `/reportes/kardex?${new URLSearchParams({ articulo: articuloId, ...(bodegaId ? { bodega: bodegaId } : {}), desde, hasta })}`;

const articulo = <F extends { articuloId: string; claveArticulo: string; descripcion: string; unidad: string; articuloActivo: boolean }>(
  enlace?: (f: F) => string,
): Columna<F>[] => [
  { titulo: "Clave", formato: "texto", valor: (f) => f.claveArticulo, enlace },
  { titulo: "Descripción", formato: "texto", valor: (f) => baja(f.descripcion, f.articuloActivo) },
  { titulo: "Unidad", formato: "texto", valor: (f) => f.unidad },
];

const valor = <F extends { importe: string | null; importeConIva: string | null; sinCosto: number }>(etiqueta: string): Columna<F>[] => [
  { titulo: `${etiqueta} sin IVA`, formato: "importe", valor: (f) => f.importe },
  { titulo: `${etiqueta} con IVA`, formato: "importe", valor: (f) => f.importeConIva },
  { titulo: "Piezas sin costo", formato: "entero", valor: (f) => f.sinCosto },
];

const movimientos = <F extends Movimientos>(): Columna<F>[] => [
  { titulo: "Saldo inicial", formato: "entero", valor: (f) => f.inicial },
  { titulo: "Compras", formato: "entero", valor: (f) => f.compras },
  { titulo: "Salidas a estaciones", formato: "entero", valor: (f) => f.salidas },
  { titulo: "Traspasos recibidos", formato: "entero", valor: (f) => f.recibidos },
  { titulo: "Traspasos enviados", formato: "entero", valor: (f) => f.enviados },
  { titulo: "Devoluciones", formato: "entero", valor: (f) => f.devoluciones },
  { titulo: "Ajustes +", formato: "entero", valor: (f) => f.ajustesMas },
  { titulo: "Ajustes −", formato: "entero", valor: (f) => f.ajustesMenos },
  { titulo: "Reversas +", formato: "entero", valor: (f) => f.reversasMas },
  { titulo: "Reversas −", formato: "entero", valor: (f) => f.reversasMenos },
  { titulo: "Saldo final", formato: "entero", valor: (f) => f.final },
  ...valor<F>("Valor final"),
];

export const columnasSemanal = (semana: { inicio: string; corte: string }): Columna<FilaSemanal>[] => [
  { titulo: "Bodega", formato: "texto", valor: (f) => baja(f.bodega, f.bodegaActiva, true) },
  ...articulo<FilaSemanal>((f) => kardexDe(f.articuloId, semana.inicio, semana.corte, f.bodegaId)),
  ...movimientos<FilaSemanal>(),
];

export const columnasTotalesSemanal = (semana: { inicio: string; corte: string }): Columna<TotalArticulo>[] => [
  ...articulo<TotalArticulo>((f) => kardexDe(f.articuloId, semana.inicio, semana.corte)),
  ...movimientos<TotalArticulo>(),
];

export const columnasExistencias = (hoy: string): Columna<FilaExistencia>[] => [
  { titulo: "Bodega", formato: "texto", valor: (f) => baja(f.bodega, f.bodegaActiva, true) },
  ...articulo<FilaExistencia>((f) => kardexDe(f.articuloId, `${hoy.slice(0, 7)}-01`, hoy, f.bodegaId)),
  { titulo: "Existencia", formato: "entero", valor: (f) => f.existencia },
  { titulo: "Mínimo", formato: "entero", valor: (f) => f.minimo },
  { titulo: "Diferencia", formato: "entero", valor: (f) => f.diferencia },
  { titulo: "Indicador", formato: "texto", valor: (f) => (f.bajoMinimo ? "Bajo mínimo" : null), insignia: "aviso" },
  ...valor<FilaExistencia>("Valor"),
];

export const columnasKardex: Columna<FilaKardex>[] = [
  { titulo: "Fecha", formato: "fecha", valor: (f) => f.fecha },
  { titulo: "Folio", formato: "texto", valor: (f) => f.folio, enlace: (f) => rutaDeMovimiento(f.tipoMovimiento, f.movimientoId) },
  { titulo: "Movimiento", formato: "texto", valor: (f) => f.tipo, enlace: (f) => (f.originalId && f.originalTipo ? rutaDeMovimiento(f.originalTipo, f.originalId) : null) },
  { titulo: "Bodega", formato: "texto", valor: (f) => f.bodega },
  { titulo: "Origen o destino", formato: "texto", valor: (f) => f.contraparte },
  { titulo: "Referencia o motivo", formato: "texto", valor: (f) => f.referencia },
  { titulo: "Entra", formato: "entero", valor: (f) => f.entra || null },
  { titulo: "Sale", formato: "entero", valor: (f) => f.sale || null },
  { titulo: "Saldo en la bodega", formato: "entero", valor: (f) => f.saldo },
  { titulo: "Importe sin IVA", formato: "importe", valor: (f) => f.importe },
  { titulo: "Importe con IVA", formato: "importe", valor: (f) => f.importeConIva },
  { titulo: "Piezas sin costo", formato: "entero", valor: (f) => f.sinCosto || null },
];

export const columnasResumenKardex: Columna<ResumenBodega>[] = [
  { titulo: "Bodega", formato: "texto", valor: (f) => baja(f.bodega, f.bodegaActiva, true) },
  { titulo: "Saldo inicial", formato: "entero", valor: (f) => f.inicial },
  { titulo: "Entradas", formato: "entero", valor: (f) => f.entradas },
  { titulo: "Salidas", formato: "entero", valor: (f) => f.salidas },
  { titulo: "Saldo final", formato: "entero", valor: (f) => f.final },
];

const estacion = <F extends { numeroEstacion: string; alias: string; estacionActiva: boolean }>(): Columna<F>[] => [
  { titulo: "Estación", formato: "texto", valor: (f) => f.numeroEstacion },
  { titulo: "Alias", formato: "texto", valor: (f) => baja(f.alias, f.estacionActiva, true) },
];

export const columnasGastoDetalle: Columna<FilaGastoDetalle>[] = [
  ...estacion<FilaGastoDetalle>(),
  { titulo: "Clave", formato: "texto", valor: (f) => f.claveArticulo },
  { titulo: "Descripción", formato: "texto", valor: (f) => baja(f.descripcion, f.articuloActivo) },
  { titulo: "Unidad", formato: "texto", valor: (f) => f.unidad },
  { titulo: "Retirado", formato: "entero", valor: (f) => f.retirado },
  { titulo: "Devuelto", formato: "entero", valor: (f) => f.devuelto },
  { titulo: "Neto", formato: "entero", valor: (f) => f.neto },
  { titulo: "Gasto conocido sin IVA", formato: "importe", valor: (f) => f.importe },
  { titulo: "Gasto conocido con IVA", formato: "importe", valor: (f) => f.importeConIva },
  { titulo: "Piezas netas sin costo", formato: "entero", valor: (f) => f.sinCosto },
];

export const columnasGastoEstacion: Columna<FilaGastoEstacion>[] = [
  ...estacion<FilaGastoEstacion>(),
  { titulo: "Artículos", formato: "entero", valor: (f) => f.articulos },
  { titulo: "Gasto conocido sin IVA", formato: "importe", valor: (f) => f.importe },
  { titulo: "Gasto conocido con IVA", formato: "importe", valor: (f) => f.importeConIva },
  { titulo: "Artículos con piezas sin costo", formato: "entero", valor: (f) => f.articulosSinCosto },
];

export const columnasFrecuencia = (rango: { desde: string; hasta: string }): Columna<FilaFrecuencia>[] => [
  ...articulo<FilaFrecuencia>((f) => kardexDe(f.articuloId, rango.desde, rango.hasta)),
  { titulo: "Retiros", formato: "entero", valor: (f) => f.retiros },
  { titulo: "De ellos, préstamos", formato: "entero", valor: (f) => f.prestamos },
  { titulo: "Unidades retiradas", formato: "entero", valor: (f) => f.unidades },
  { titulo: "Último retiro", formato: "fecha", valor: (f) => f.ultimo },
];
