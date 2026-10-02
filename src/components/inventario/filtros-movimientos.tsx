"use client";

import { Input, Select } from "@/components/ui/campos";
import { useFiltrosEnUrl } from "@/components/ui/filtros-en-url";
import { SelectorDeRango } from "@/components/ui/selector-rango";
import { aParametros, ESTATUS, hayFiltros, SIN_FILTROS, SIN_FILTROS_DE_HOJAS, type FiltroEstatus, type FiltrosDeLista } from "@/lib/inventario/filtros";

export function FiltrosMovimientos({
  filtros,
  total,
  tramo,
  sustantivo,
  busqueda = true,
  fechas = false,
}: {
  filtros: FiltrosDeLista;
  total: number;
  tramo: boolean;
  sustantivo: [string, string];
  busqueda?: boolean;
  /** Rango de días, como en entradas. */
  fechas?: boolean;
}) {
  const { actual, pendiente, aplicar, teclear } = useFiltrosEnUrl(filtros, aParametros);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        {busqueda && (
          <Input
            type="search"
            value={actual.busqueda}
            onChange={(ev) => teclear({ busqueda: ev.target.value })}
            placeholder="Folio, bodega, estación, motivo…"
            className="h-8 w-72"
            aria-label={`Buscar ${sustantivo[1]}`}
          />
        )}
        <Select value={actual.estatus} onChange={(ev) => aplicar({ estatus: ev.target.value as FiltroEstatus })} className="h-8 w-40" aria-label="Estatus">
          {ESTATUS.map((f) => (
            <option key={f.valor} value={f.valor}>{f.etiqueta}</option>
          ))}
        </Select>
        {fechas && <SelectorDeRango valor={{ desde: actual.desde ?? "", hasta: actual.hasta ?? "" }} onChange={(r) => aplicar(r)} />}
        {hayFiltros(actual) && (
          <button type="button" onClick={() => aplicar(fechas ? SIN_FILTROS_DE_HOJAS : SIN_FILTROS)} className="text-sm text-primary hover:underline">
            Limpiar
          </button>
        )}
      </div>
      <p className="text-sm text-muted tabular" aria-live="polite">
        {pendiente ? "Buscando…" : `${total} ${total === 1 ? sustantivo[0] : sustantivo[1]}${tramo ? " en este tramo" : ""}`}
      </p>
    </div>
  );
}
