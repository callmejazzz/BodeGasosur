"use client";

import Link from "next/link";
import { BadgeEstatusSalida } from "@/components/salidas/estatus-salida";
import type { FilaSalida } from "@/components/salidas/filas";
import { Paginador, usePaginaMedida } from "@/components/ui/paginacion";
import { Badge } from "@/components/ui/superficies";
import { Tabla, Td, Th, Tr } from "@/components/ui/tabla";

export function TablaSalidas({ filas, siguienteHref, inicioHref }: { filas: FilaSalida[]; siguienteHref: string | null; inicioHref: string | null }) {
  const { contenedor, visibles, actual, totalPaginas, irA } = usePaginaMedida(filas);

  return (
    <div ref={contenedor}>
      <Tabla>
        <thead>
          <tr>
            <Th>Folio</Th>
            <Th>Fecha</Th>
            <Th>Bodega origen</Th>
            <Th>Estación</Th>
            <Th>Solicitante</Th>
            <Th className="text-right">Partidas</Th>
            <Th>Estatus</Th>
          </tr>
        </thead>
        <tbody>
          {visibles.map((s) => (
            <Tr key={s.id}>
              <Td className="whitespace-nowrap">
                <Link href={`/salidas/${s.id}`} className="font-medium text-primary hover:underline">
                  {s.folio ?? "Sin folio"}
                </Link>
              </Td>
              <Td className="whitespace-nowrap">{s.fecha}</Td>
              <Td>{s.bodega}</Td>
              <Td>{s.estacion}</Td>
              <Td>{s.solicitante ?? <span className="text-muted">—</span>}</Td>
              <Td className="text-right tabular">{s.partidas}</Td>
              <Td>
                <span className="flex flex-wrap items-center gap-1.5">
                  <BadgeEstatusSalida estatus={s.estatus} />
                  {s.prestamo && <Badge>Préstamo</Badge>}
                </span>
              </Td>
            </Tr>
          ))}
        </tbody>
      </Tabla>

      {totalPaginas > 1 && (
        <Paginador
          texto={`${filas.length} salidas en este tramo`}
          actual={actual}
          totalPaginas={totalPaginas}
          irA={irA}
        />
      )}
      {(inicioHref || siguienteHref) && (
        <nav aria-label="Tramos de salidas" className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3 text-sm">
          {inicioHref ? <Link href={inicioHref} className="text-primary hover:underline">Volver a las más recientes</Link> : <span />}
          {siguienteHref && <Link href={siguienteHref} className="text-primary hover:underline">Ver salidas anteriores</Link>}
        </nav>
      )}
    </div>
  );
}
