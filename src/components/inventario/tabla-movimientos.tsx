"use client";

import Link from "next/link";
import { BadgeEstatus } from "@/components/inventario/estatus";
import type { FilaMovimiento } from "@/components/inventario/filas";
import { Paginador, usePaginaMedida } from "@/components/ui/paginacion";
import { Tabla, Td, Th, Tr } from "@/components/ui/tabla";

type Columna = "origen" | "destino" | "estacion" | "detalle";

const ETIQUETAS: Record<Columna, string> = { origen: "Bodega origen", destino: "Bodega destino", estacion: "Estación", detalle: "Detalle" };

export function TablaMovimientos({
  ruta,
  filas,
  columnas,
  siguienteHref,
  inicioHref,
}: {
  ruta: string;
  filas: FilaMovimiento[];
  columnas: Columna[];
  siguienteHref: string | null;
  inicioHref: string | null;
}) {
  const { contenedor, visibles, actual, totalPaginas, irA } = usePaginaMedida(filas);
  return (
    <div ref={contenedor}>
      <Tabla>
        <thead>
          <tr>
            <Th>Folio</Th>
            <Th>Fecha</Th>
            {columnas.map((c) => (
              <Th key={c}>{ETIQUETAS[c]}</Th>
            ))}
            <Th className="text-right">Partidas</Th>
            <Th>Estatus</Th>
          </tr>
        </thead>
        <tbody>
          {visibles.map((m) => (
            <Tr key={m.id}>
              <Td className="whitespace-nowrap">
                <Link href={`${ruta}/${m.id}`} className="font-medium text-primary hover:underline">
                  {m.folio ?? "Sin folio"}
                </Link>
              </Td>
              <Td className="whitespace-nowrap">{m.fecha}</Td>
              {columnas.map((c) => (
                <Td key={c} className={c === "detalle" ? "max-w-72 truncate text-muted-strong" : undefined}>
                  {m[c] ?? <span className="text-muted">—</span>}
                </Td>
              ))}
              <Td className="text-right tabular">{m.partidas}</Td>
              <Td>
                <BadgeEstatus estatus={m.estatus} revertido={m.revertido} esReversa={m.esReversa} />
              </Td>
            </Tr>
          ))}
        </tbody>
      </Tabla>
      {totalPaginas > 1 && <Paginador texto={`${filas.length} en este tramo`} actual={actual} totalPaginas={totalPaginas} irA={irA} />}
      {(inicioHref || siguienteHref) && (
        <nav aria-label="Tramos" className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3 text-sm">
          {inicioHref ? <Link href={inicioHref} className="text-primary hover:underline">Volver a los más recientes</Link> : <span />}
          {siguienteHref && <Link href={siguienteHref} className="text-primary hover:underline">Ver anteriores</Link>}
        </nav>
      )}
    </div>
  );
}
