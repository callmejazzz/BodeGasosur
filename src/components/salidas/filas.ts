import { formatearFecha } from "@/lib/fechas";
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
};

export function filaDeSalida(s: SalidaResumen): FilaSalida {
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
  };
}
