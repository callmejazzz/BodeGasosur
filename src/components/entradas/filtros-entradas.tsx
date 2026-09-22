"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Input, Select } from "@/components/ui/campos";
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

/*
  Los filtros viven en la URL: el servidor consulta y esta barra solo la
  reescribe. El texto se aplica con un pequeño retardo mientras se teclea; los
  demás controles, al instante.
*/

const RETARDO_MS = 50;

export function FiltrosEntradas({ filtros, total, hayMas }: { filtros: FiltroEntradas; total: number; hayMas: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pendiente, iniciar] = useTransition();
  // `ultimo` es el último filtro que la persona pidió, aplicado o en espera;
  // toda navegación sale de ahí, así que un retardo pendiente nunca pisa un
  // cambio posterior. `actual` es lo mismo, para que los controles lo dibujen.
  const ultimo = useRef(filtros);
  const [actual, setActual] = useState(filtros);
  const navegado = useRef(aParametros(filtros).toString());
  const temporizador = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Si la URL cambia por fuera (atrás/adelante), la barra la adopta.
  const claveUrl = aParametros(filtros).toString();
  useEffect(() => {
    if (claveUrl === navegado.current) return;
    navegado.current = claveUrl;
    ultimo.current = filtros;
    setActual(filtros);
  }, [claveUrl, filtros]);

  useEffect(() => () => clearTimeout(temporizador.current), []);

  const navegar = () => {
    clearTimeout(temporizador.current);
    const p = aParametros(ultimo.current);
    navegado.current = p.toString();
    iniciar(() => router.replace(p.size ? `${pathname}?${p}` : pathname, { scroll: false }));
  };

  const recordar = (cambios: Partial<FiltroEntradas>) => {
    ultimo.current = { ...ultimo.current, ...cambios };
    setActual(ultimo.current);
  };

  /** Cambio inmediato: cancela lo que estuviera en espera y navega con todo lo pedido. */
  const aplicar = (cambios: Partial<FiltroEntradas>) => {
    recordar(cambios);
    navegar();
  };

  const teclear = (texto: string) => {
    recordar({ busqueda: texto });
    clearTimeout(temporizador.current);
    temporizador.current = setTimeout(navegar, RETARDO_MS);
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={actual.busqueda}
          onChange={(ev) => teclear(ev.target.value)}
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
        {pendiente ? "Buscando…" : hayMas ? `Más de ${total} entradas` : `${total} entrada${total === 1 ? "" : "s"}`}
      </p>
    </div>
  );
}
