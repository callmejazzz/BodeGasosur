"use client";

import { Input, Select } from "@/components/ui/campos";
import { useFiltrosEnUrl } from "@/components/ui/filtros-en-url";
import { SelectorDeRango } from "@/components/ui/selector-rango";
import {
  aParametros,
  ESTATUS,
  hayFiltros,
  REFERENCIA,
  SIN_FILTROS,
  type FiltroEntradas,
  type FiltroEstatus,
  type FiltroReferencia,
} from "@/lib/entradas/filtros";

export function FiltrosEntradas({ filtros, total }: { filtros: FiltroEntradas; total: number }) {
  const { actual, pendiente, aplicar, teclear } = useFiltrosEnUrl(filtros, aParametros);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={actual.busqueda}
          onChange={(ev) => teclear({ busqueda: ev.target.value })}
          placeholder="Folio, referencia, proveedor o bodega…"
          className="h-8 w-72"
          aria-label="Buscar entradas"
        />
        <Select value={actual.estatus} onChange={(ev) => aplicar({ estatus: ev.target.value as FiltroEstatus })} className="h-8 w-36" aria-label="Estatus">
          {ESTATUS.map((f) => (
            <option key={f.valor} value={f.valor}>{f.etiqueta}</option>
          ))}
        </Select>
        <Select value={actual.referencia} onChange={(ev) => aplicar({ referencia: ev.target.value as FiltroReferencia })} className="h-8 w-48" aria-label="Referencia">
          {REFERENCIA.map((f) => (
            <option key={f.valor} value={f.valor}>{f.etiqueta}</option>
          ))}
        </Select>
        <SelectorDeRango valor={{ desde: actual.desde, hasta: actual.hasta }} onChange={(r) => aplicar(r)} />
        {hayFiltros(actual) && (
          <button type="button" onClick={() => aplicar(SIN_FILTROS)} className="text-sm text-primary hover:underline">
            Limpiar
          </button>
        )}
      </div>
      <p className="text-sm text-muted tabular" aria-live="polite">
        {pendiente ? "Buscando…" : `${total} entrada${total === 1 ? "" : "s"}`}
      </p>
    </div>
  );
}
