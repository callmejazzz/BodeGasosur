"use client";

import { Checkbox, Input, Select } from "@/components/ui/campos";
import { useFiltrosEnUrl } from "@/components/ui/filtros-en-url";
import { aParametros, ESTATUS, hayFiltros, SIN_FILTROS, type FiltroEstatus, type FiltrosDeLista } from "@/lib/salidas/filtros";

export function FiltrosSalidas({ filtros, total }: { filtros: FiltrosDeLista; total: number }) {
  const { actual, pendiente, aplicar, teclear } = useFiltrosEnUrl(filtros, aParametros);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={actual.busqueda}
          onChange={(ev) => teclear({ busqueda: ev.target.value })}
          placeholder="Folio, bodega, estación, solicitante…"
          className="h-8 w-72"
          aria-label="Buscar salidas"
        />
        <Select value={actual.estatus} onChange={(ev) => aplicar({ estatus: ev.target.value as FiltroEstatus })} className="h-8 w-36" aria-label="Estatus">
          {ESTATUS.map((f) => (
            <option key={f.valor} value={f.valor}>{f.etiqueta}</option>
          ))}
        </Select>
        <label className="flex h-8 items-center gap-2 rounded-md border border-border-strong px-3 text-sm text-foreground">
          <Checkbox checked={actual.prestamo} onChange={(ev) => aplicar({ prestamo: ev.target.checked })} />
          Solo préstamos
        </label>
        {hayFiltros(actual) && (
          <button type="button" onClick={() => aplicar(SIN_FILTROS)} className="text-sm text-primary hover:underline">
            Limpiar
          </button>
        )}
      </div>
      <p className="text-sm text-muted tabular" aria-live="polite">
        {pendiente ? "Buscando…" : `${total} salida${total === 1 ? "" : "s"}`}
      </p>
    </div>
  );
}
