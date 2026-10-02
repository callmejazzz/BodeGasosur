"use client";

import Link from "next/link";
import { BadgeEstatus } from "@/components/entradas/detalle-entrada";
import { Paginador, usePaginaMedida } from "@/components/ui/paginacion";
import { Badge, Estados } from "@/components/ui/superficies";
import { Tabla, Td, Th, Tr } from "@/components/ui/tabla";

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
  revertida: boolean;
};

export function TablaEntradas({ filas, hayMas }: { filas: FilaEntrada[]; hayMas: boolean }) {
  const { contenedor, visibles, actual, totalPaginas, irA } = usePaginaMedida(filas);

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
              <Td>
                <Estados>
                  <BadgeEstatus estatus={e.estatus} />
                  {e.revertida && <Badge tono="peligro">Revertida</Badge>}
                </Estados>
              </Td>
            </Tr>
          ))}
        </tbody>
      </Tabla>

      {(totalPaginas > 1 || hayMas) && (
        <Paginador
          texto={hayMas ? `Se muestran las ${filas.length} más recientes; afina los filtros para ver el resto.` : `${filas.length} entradas`}
          actual={actual}
          totalPaginas={totalPaginas}
          irA={irA}
        />
      )}
    </div>
  );
}
