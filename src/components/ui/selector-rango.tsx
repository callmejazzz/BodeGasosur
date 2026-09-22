"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { aFechaDeBase, FECHA_MINIMA_OPERATIVA, formatearFecha, hoyEnMexico } from "@/lib/fechas";
import { cn } from "@/lib/utils";

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const DIAS = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (a: number, m: number, d: number) => new Date(Date.UTC(a, m, d));

/** Seis semanas que cubren el mes, de lunes a domingo, con los días vecinos que sobran. */
function celdas(anio: number, mes: number) {
  const primero = utc(anio, mes, 1);
  const desplazamiento = (primero.getUTCDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, i) => {
    const d = utc(anio, mes, 1 - desplazamiento + i);
    return { valor: iso(d), dia: d.getUTCDate(), delMes: d.getUTCMonth() === mes };
  });
}

export type Rango = { desde: string; hasta: string };

export function SelectorDeRango({ valor, onChange, etiqueta = "Fechas" }: { valor: Rango; onChange: (r: Rango) => void; etiqueta?: string }) {
  const [abierto, setAbierto] = useState(false);
  const [inicio, setInicio] = useState<string | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  // «Hoy» es el de México, no el del reloj del navegador (fechas.ts).
  const hoy = hoyEnMexico();
  const [vista, setVista] = useState(() => {
    const base = valor.desde || valor.hasta || hoy;
    return { anio: Number(base.slice(0, 4)), mes: Number(base.slice(5, 7)) - 1 };
  });
  const contenedor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const cerrar = (ev: MouseEvent | KeyboardEvent) => {
      if (ev instanceof KeyboardEvent ? ev.key === "Escape" : !contenedor.current?.contains(ev.target as Node)) {
        setAbierto(false);
        setInicio(null);
      }
    };
    document.addEventListener("mousedown", cerrar);
    document.addEventListener("keydown", cerrar);
    return () => {
      document.removeEventListener("mousedown", cerrar);
      document.removeEventListener("keydown", cerrar);
    };
  }, [abierto]);

  const elegir = (dia: string) => {
    if (!inicio) {
      setInicio(dia);
      return;
    }
    const [desde, hasta] = inicio <= dia ? [inicio, dia] : [dia, inicio];
    setInicio(null);
    setAbierto(false);
    onChange({ desde, hasta });
  };

  const mover = (delta: number) =>
    setVista((v) => {
      const d = utc(v.anio, v.mes + delta, 1);
      return { anio: d.getUTCFullYear(), mes: d.getUTCMonth() };
    });

  // Mientras se elige el fin, el rango se dibuja desde el inicio hasta donde está el cursor.
  const [marcaDesde, marcaHasta] = inicio
    ? [inicio, sobre ?? inicio].sort()
    : [valor.desde || null, valor.hasta || valor.desde || null];
  const enRango = (d: string) => marcaDesde !== null && marcaHasta !== null && d >= marcaDesde && d <= marcaHasta;
  const esExtremo = (d: string) => d === marcaDesde || d === marcaHasta;

  const texto =
    valor.desde || valor.hasta
      ? `Del ${valor.desde ? formatearFecha(aFechaDeBase(valor.desde)) : "inicio"} al ${valor.hasta ? formatearFecha(aFechaDeBase(valor.hasta)) : "final"}`
      : etiqueta;
  const anioMinimo = Number(FECHA_MINIMA_OPERATIVA.slice(0, 4));
  const anios = Array.from({ length: Number(hoy.slice(0, 4)) - anioMinimo + 1 }, (_, i) => anioMinimo + i);

  return (
    <div ref={contenedor} className="relative">
      <Button type="button" variante="secundario" tamano="sm" onClick={() => setAbierto((a) => !a)} aria-expanded={abierto} aria-haspopup="dialog">
        <span aria-hidden>📅</span>
        {texto}
      </Button>

      {abierto && (
        <div role="dialog" aria-label="Elegir rango de fechas" className="absolute left-0 z-20 mt-1 w-80 rounded-lg border border-border bg-surface p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between gap-2">
            <Button type="button" variante="sutil" tamano="sm" onClick={() => mover(-1)} aria-label="Mes anterior">‹</Button>
            <div className="flex gap-1">
              <select value={vista.mes} onChange={(ev) => setVista((v) => ({ ...v, mes: Number(ev.target.value) }))} className="rounded-md border border-border bg-surface px-2 py-1 text-sm font-medium" aria-label="Mes">
                {MESES.map((m, i) => (
                  <option key={m} value={i}>{m}</option>
                ))}
              </select>
              <select value={vista.anio} onChange={(ev) => setVista((v) => ({ ...v, anio: Number(ev.target.value) }))} className="rounded-md border border-border bg-surface px-2 py-1 text-sm font-medium" aria-label="Año">
                {anios.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
            <Button type="button" variante="sutil" tamano="sm" onClick={() => mover(1)} aria-label="Mes siguiente">›</Button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted">
            {DIAS.map((d) => (
              <span key={d} className="py-1">{d}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1" onMouseLeave={() => setSobre(null)}>
            {celdas(vista.anio, vista.mes).map((c) => (
              <button
                key={c.valor}
                type="button"
                onClick={() => elegir(c.valor)}
                onMouseEnter={() => setSobre(c.valor)}
                aria-pressed={esExtremo(c.valor)}
                className={cn(
                  "h-9 rounded-md text-sm tabular transition-colors",
                  c.delMes ? "text-foreground hover:bg-surface-muted" : "text-muted/50",
                  enRango(c.valor) && "bg-primary-soft text-primary",
                  esExtremo(c.valor) && "bg-primary text-white hover:bg-primary-hover",
                )}
              >
                {c.dia}
              </button>
            ))}
          </div>

          <div className="mt-3 flex items-center justify-between text-xs text-muted">
            <span>{inicio ? "Ahora elige el día final" : "Elige el día inicial"}</span>
            {(valor.desde || valor.hasta) && (
              <button
                type="button"
                onClick={() => {
                  setInicio(null);
                  setAbierto(false);
                  onChange({ desde: "", hasta: "" });
                }}
                className="text-primary hover:underline"
              >
                Quitar fechas
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
