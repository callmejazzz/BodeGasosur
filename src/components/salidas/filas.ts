import { formatearFecha } from "@/lib/fechas";
import type { EstadoDevolucion } from "@/lib/inventario/repo";
import type { SalidaResumen } from "@/lib/salidas/repo";

/** Una salida en una tabla. Al cliente viaja texto ya formateado: nada de Date en las props. */
export type FilaSalida = {
  id: string;
  folio: string | null;
  estatus: string;
  fecha: string;
  bodega: string;
  estacion: string;
  solicitante: string | null;
  partidas: number;
  prestamo: boolean;
  revertida: boolean;
  devolucion: EstadoDevolucion | null;
};

export function filaDeSalida(s: SalidaResumen, devolucion?: EstadoDevolucion): FilaSalida {
  return {
    id: s.id,
    folio: s.folio,
    estatus: s.estatus,
    fecha: formatearFecha(s.fecha),
    bodega: s.bodegaOrigen ? `${s.bodegaOrigen.nombre}` : "—",
    estacion: s.estacion ? `${s.estacion.alias}` : "—",
    solicitante: s.solicitadoPor?.nombre ?? null,
    partidas: s._count.partidas,
    prestamo: s.esPrestamo,
    revertida: !!s.canceladoPor,
    devolucion: devolucion ?? null,
  };
}
