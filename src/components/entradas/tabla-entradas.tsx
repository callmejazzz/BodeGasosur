"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BadgeEstatus } from "@/components/entradas/detalle-entrada";
import { Button } from "@/components/ui/button";
import { Tabla, Td, Th, Tr } from "@/components/ui/tabla";

/*
  Paginación en el cliente sobre lo que el servidor ya entregó (≤ 200 filas).
  El tamaño de página se mide: caben las filas que quepan entre el inicio de
  la tabla y el borde inferior de la ventana, dejando sitio al paginador.
*/

export type FilaEntrada = {
  id: string;
  folio: string | null;
  estatus: string;
  fecha: string;
  proveedor: string;
  referencia: string | null;
  bodega: string;
  partidas: number;
  total: string;
};

const POR_PAGINA_INICIAL = 12;
const MINIMO_POR_PAGINA = 5;
const ALTO_PAGINADOR = 56;

export function TablaEntradas({ filas, hayMas }: { filas: FilaEntrada[]; hayMas: boolean }) {
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

  return (
    <div ref={contenedor}>
      <Tabla>
        <thead>
          <tr>
            <Th>Folio</Th>
            <Th>Fecha</Th>
            <Th>Proveedor</Th>
            <Th>Referencia</Th>
            <Th>Bodega</Th>
            <Th className="text-right">Partidas</Th>
            <Th className="text-right">Total</Th>
            <Th>Estatus</Th>
          </tr>
        </thead>
        <tbody>
          {visibles.map((e) => (
            <Tr key={e.id}>
              <Td className="whitespace-nowrap">
                <Link href={`/entradas/${e.id}`} className="font-medium text-primary hover:underline">
                  {e.folio ?? (e.estatus === "BORRADOR" ? "Borrador" : "Sin folio")}
                </Link>
              </Td>
              <Td className="whitespace-nowrap">{e.fecha}</Td>
              <Td>{e.proveedor}</Td>
              <Td>{e.referencia ?? <span className="text-muted">—</span>}</Td>
              <Td>{e.bodega}</Td>
              <Td className="text-right tabular">{e.partidas}</Td>
              <Td className="text-right tabular whitespace-nowrap">{e.total}</Td>
              <Td><BadgeEstatus estatus={e.estatus} /></Td>
            </Tr>
          ))}
        </tbody>
      </Tabla>

      {(totalPaginas > 1 || hayMas) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3 text-sm text-muted">
          <span>
            {hayMas ? `Se muestran las ${filas.length} más recientes; afina los filtros para ver el resto.` : `${filas.length} entradas`}
          </span>
          {totalPaginas > 1 && (
            <span className="flex items-center gap-2">
              <Button type="button" variante="sutil" tamano="sm" onClick={() => setPagina(actual - 1)} disabled={actual === 1} aria-label="Página anterior">‹</Button>
              <span className="tabular">Página {actual} de {totalPaginas}</span>
              <Button type="button" variante="sutil" tamano="sm" onClick={() => setPagina(actual + 1)} disabled={actual === totalPaginas} aria-label="Página siguiente">›</Button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
