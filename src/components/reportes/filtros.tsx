"use client";

import { useState, type ReactNode } from "react";
import { Checkbox, Input, Select } from "@/components/ui/campos";
import { useFiltrosEnUrl } from "@/components/ui/filtros-en-url";
import { SelectorBuscable, type PaginaDeOpciones } from "@/components/ui/selector-buscable";
import { SelectorDeRango } from "@/components/ui/selector-rango";
import { hoyEnMexico, sumarDias } from "@/lib/fechas";
import {
  aParametrosExistencias,
  aParametrosFrecuencia,
  aParametrosGasto,
  aParametrosKardex,
  aParametrosSemanal,
  viernesDeCorte,
  type FiltrosExistencias,
  type FiltrosFrecuencia,
  type FiltrosGasto,
  type FiltrosKardex,
  type FiltrosSemanal,
} from "@/lib/reportes/filtros";

type Opcion = { id: string; nombre: string };
type Articulo = { id: string; clave: string; descripcion: string; unidad: string; activo: boolean };
type Buscar = (texto: string, pagina: number) => Promise<PaginaDeOpciones<Articulo>>;

function Barra({ children, total, pendiente, sustantivo }: { children: ReactNode; total?: number; pendiente: boolean; sustantivo?: [string, string] }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      <p className="text-sm text-muted tabular" aria-live="polite">
        {pendiente ? "Buscando…" : total !== undefined && sustantivo ? `${total} ${total === 1 ? sustantivo[0] : sustantivo[1]}` : null}
      </p>
    </div>
  );
}

function Catalogo({ valor, opciones, todas, etiqueta, onChange }: { valor: string; opciones: Opcion[]; todas: string; etiqueta: string; onChange: (id: string) => void }) {
  return (
    <Select value={valor} onChange={(ev) => onChange(ev.target.value)} className="h-8 w-56" aria-label={etiqueta}>
      <option value="">{todas}</option>
      {opciones.map((o) => (
        <option key={o.id} value={o.id}>{o.nombre}</option>
      ))}
    </Select>
  );
}

const Busqueda = ({ valor, onChange }: { valor: string; onChange: (q: string) => void }) => (
  <Input type="search" value={valor} onChange={(ev) => onChange(ev.target.value)} placeholder="Clave o descripción del artículo…" className="h-8 w-64" aria-label="Buscar artículo" />
);

const Limpiar = ({ onClick }: { onClick: () => void }) => (
  <button type="button" onClick={onClick} className="text-sm text-primary hover:underline">
    Limpiar
  </button>
);

/** El artículo elegido se conserva mientras la URL lo confirma. */
function SelectorDeArticulo({ articulo, buscar, alElegir, vacio }: { articulo: Articulo | null; buscar: Buscar; alElegir: (id: string) => void; vacio: string }) {
  const [elegido, setElegido] = useState(articulo);
  const [previo, setPrevio] = useState(articulo);
  if (articulo?.id !== previo?.id) {
    setPrevio(articulo);
    setElegido(articulo);
  }
  return (
    <div className="w-72">
      <SelectorBuscable<Articulo>
        valor={elegido}
        alElegir={(o) => {
          setElegido(o);
          alElegir(o?.id ?? "");
        }}
        cargar={buscar}
        etiqueta={(a) => `${a.clave} · ${a.descripcion}`}
        detalle={(a) => `${a.unidad}${a.activo ? "" : " · dado de baja"}`}
        vacio={vacio}
        placeholder="Clave o descripción…"
      />
    </div>
  );
}

// ───────────────────────────────── Reportes ──────────────────────────────────

export function FiltrosSemanal({ filtros, bodegas, total }: { filtros: FiltrosSemanal; bodegas: Opcion[]; total: number }) {
  const { actual, pendiente, aplicar, teclear } = useFiltrosEnUrl(filtros, aParametrosSemanal);
  const ultimo = viernesDeCorte(hoyEnMexico());
  const semana = (dias: number) => aplicar({ viernes: sumarDias(actual.viernes, dias) });
  return (
    <Barra total={total} pendiente={pendiente} sustantivo={["fila", "filas"]}>
      <button type="button" onClick={() => semana(-7)} className="rounded-md px-2 py-1 text-sm text-primary hover:bg-surface-muted" aria-label="Semana anterior">
        ‹
      </button>
      <label className="flex items-center gap-2 text-sm text-muted-strong">
        Viernes
        <Input type="date" value={actual.viernes} max={ultimo} onChange={(ev) => ev.target.value && aplicar({ viernes: ev.target.value })} className="h-8 w-40" aria-label="Viernes de corte" />
      </label>
      <button
        type="button"
        onClick={() => semana(7)}
        disabled={actual.viernes >= ultimo}
        className="rounded-md px-2 py-1 text-sm text-primary hover:bg-surface-muted disabled:text-muted/60"
        aria-label="Semana siguiente"
      >
        ›
      </button>
      <Catalogo valor={actual.bodegaId} opciones={bodegas} todas="Todas las bodegas" etiqueta="Bodega" onChange={(bodegaId) => aplicar({ bodegaId })} />
      <Busqueda valor={actual.busqueda} onChange={(busqueda) => teclear({ busqueda })} />
      {(actual.bodegaId || actual.busqueda || actual.viernes !== ultimo) && <Limpiar onClick={() => aplicar({ viernes: ultimo, bodegaId: "", busqueda: "" })} />}
    </Barra>
  );
}

export function FiltrosExistencias({ filtros, bodegas, total }: { filtros: FiltrosExistencias; bodegas: Opcion[]; total: number }) {
  const { actual, pendiente, aplicar, teclear } = useFiltrosEnUrl(filtros, aParametrosExistencias);
  return (
    <Barra total={total} pendiente={pendiente} sustantivo={["fila", "filas"]}>
      <Catalogo valor={actual.bodegaId} opciones={bodegas} todas="Todas las bodegas" etiqueta="Bodega" onChange={(bodegaId) => aplicar({ bodegaId })} />
      <Busqueda valor={actual.busqueda} onChange={(busqueda) => teclear({ busqueda })} />
      <label className="flex h-8 items-center gap-2 rounded-md border border-border-strong px-3 text-sm text-foreground">
        <Checkbox checked={actual.bajoMinimo} onChange={(ev) => aplicar({ bajoMinimo: ev.target.checked })} />
        Solo bajo mínimo
      </label>
      {(actual.bodegaId || actual.busqueda || actual.bajoMinimo) && <Limpiar onClick={() => aplicar({ bodegaId: "", busqueda: "", bajoMinimo: false })} />}
    </Barra>
  );
}

export function FiltrosKardex({ filtros, articulo, bodegas, buscar, total }: { filtros: FiltrosKardex; articulo: Articulo | null; bodegas: Opcion[]; buscar: Buscar; total?: number }) {
  const { actual, pendiente, aplicar } = useFiltrosEnUrl(filtros, aParametrosKardex);
  return (
    <Barra total={total} pendiente={pendiente} sustantivo={["movimiento", "movimientos"]}>
      <SelectorDeArticulo articulo={articulo} buscar={buscar} alElegir={(articuloId) => aplicar({ articuloId })} vacio="Elige un artículo" />
      <Catalogo valor={actual.bodegaId} opciones={bodegas} todas="Todas las bodegas" etiqueta="Bodega" onChange={(bodegaId) => aplicar({ bodegaId })} />
      <SelectorDeRango valor={{ desde: actual.desde, hasta: actual.hasta }} onChange={(r) => aplicar(r)} />
    </Barra>
  );
}

export function FiltrosGasto({ filtros, articulo, estaciones, buscar, total }: { filtros: FiltrosGasto; articulo: Articulo | null; estaciones: Opcion[]; buscar: Buscar; total: number }) {
  const { actual, pendiente, aplicar } = useFiltrosEnUrl(filtros, aParametrosGasto);
  return (
    <Barra total={total} pendiente={pendiente} sustantivo={actual.detalle ? ["fila", "filas"] : ["estación", "estaciones"]}>
      <SelectorDeRango valor={{ desde: actual.desde, hasta: actual.hasta }} onChange={(r) => aplicar(r)} />
      <Catalogo valor={actual.estacionId} opciones={estaciones} todas="Todas las estaciones" etiqueta="Estación" onChange={(estacionId) => aplicar({ estacionId })} />
      <SelectorDeArticulo articulo={articulo} buscar={buscar} alElegir={(articuloId) => aplicar({ articuloId })} vacio="Todos los artículos" />
      <Select value={actual.detalle ? "1" : ""} onChange={(ev) => aplicar({ detalle: ev.target.value === "1" })} className="h-8 w-52" aria-label="Vista">
        <option value="">Por estación</option>
        <option value="1">Por estación y artículo</option>
      </Select>
    </Barra>
  );
}

export function FiltrosFrecuencia({ filtros, estaciones, bodegas, total }: { filtros: FiltrosFrecuencia; estaciones: Opcion[]; bodegas: Opcion[]; total: number }) {
  const { actual, pendiente, aplicar, teclear } = useFiltrosEnUrl(filtros, aParametrosFrecuencia);
  return (
    <Barra total={total} pendiente={pendiente} sustantivo={["artículo", "artículos"]}>
      <SelectorDeRango valor={{ desde: actual.desde, hasta: actual.hasta }} onChange={(r) => aplicar(r)} />
      <Catalogo valor={actual.estacionId} opciones={estaciones} todas="Todas las estaciones" etiqueta="Estación" onChange={(estacionId) => aplicar({ estacionId })} />
      <Catalogo valor={actual.bodegaId} opciones={bodegas} todas="Todas las bodegas" etiqueta="Bodega de salida" onChange={(bodegaId) => aplicar({ bodegaId })} />
      <Busqueda valor={actual.busqueda} onChange={(busqueda) => teclear({ busqueda })} />
    </Barra>
  );
}
