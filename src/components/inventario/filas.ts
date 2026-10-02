import { formatearFecha } from "@/lib/fechas";
import type { MovimientoResumen } from "@/lib/inventario/repo";

/** Un movimiento en una tabla. Al cliente viaja texto ya formateado: nada de Date en las props. */
export type FilaMovimiento = {
  id: string;
  folio: string | null;
  estatus: string;
  fecha: string;
  origen: string | null;
  destino: string | null;
  estacion: string | null;
  detalle: string | null;
  partidas: number;
  revertido: boolean;
  esReversa: boolean;
};

export function filaDeMovimiento(m: MovimientoResumen): FilaMovimiento {
  return {
    id: m.id,
    folio: m.folio,
    estatus: m.estatus,
    fecha: formatearFecha(m.fecha),
    origen: m.bodegaOrigen?.nombre ?? null,
    destino: m.bodegaDestino?.nombre ?? null,
    estacion: m.estacion?.alias ?? null,
    detalle: m.cancelaA ? `Reversa de ${m.cancelaA.folio}` : m.devuelveA ? `De ${m.devuelveA.folio}` : m.motivo,
    partidas: m._count.partidas,
    revertido: !!m.canceladoPor,
    esReversa: !!m.cancelaA,
  };
}
