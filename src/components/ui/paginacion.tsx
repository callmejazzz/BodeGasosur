"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/*
  Paginación en el cliente sobre lo que el servidor ya entregó (≤ 200 filas).
  El tamaño de página se mide: caben las filas que quepan entre el inicio de
  la tabla y el borde inferior de la ventana, dejando sitio al paginador.
*/

const POR_PAGINA_INICIAL = 12;
const MINIMO_POR_PAGINA = 5;
const ALTO_PAGINADOR = 56;

export function usePaginaMedida<T>(filas: T[]) {
  const contenedor = useRef<HTMLDivElement>(null);
  const [porPagina, setPorPagina] = useState(POR_PAGINA_INICIAL);
  const [pagina, setPagina] = useState(1);

  useEffect(() => {
    const medir = () => {
      const el = contenedor.current;
      if (!el) return;
      const fila = el.querySelector("tbody tr")?.getBoundingClientRect().height || 49;
      const encabezado = el.querySelector("thead")?.getBoundingClientRect().height || 40;
      const inicio = el.getBoundingClientRect().top + window.scrollY;
      const disponible = window.innerHeight - inicio - encabezado - ALTO_PAGINADOR;
      setPorPagina(Math.max(MINIMO_POR_PAGINA, Math.floor(disponible / fila)));
    };
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, []);

  const totalPaginas = Math.max(1, Math.ceil(filas.length / porPagina));
  const actual = Math.min(pagina, totalPaginas);
  const visibles = filas.slice((actual - 1) * porPagina, actual * porPagina);
  return { contenedor, visibles, actual, totalPaginas, irA: setPagina };
}

export function Paginador({
  texto,
  actual,
  totalPaginas,
  irA,
}: {
  texto: string;
  actual: number;
  totalPaginas: number;
  irA: (pagina: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3 text-sm text-muted">
      <span>{texto}</span>
      {totalPaginas > 1 && (
        <span className="flex items-center gap-2">
          <Button type="button" variante="sutil" tamano="sm" onClick={() => irA(actual - 1)} disabled={actual === 1} aria-label="Página anterior">‹</Button>
          <span className="tabular">Página {actual} de {totalPaginas}</span>
          <Button type="button" variante="sutil" tamano="sm" onClick={() => irA(actual + 1)} disabled={actual === totalPaginas} aria-label="Página siguiente">›</Button>
        </span>
      )}
    </div>
  );
}
