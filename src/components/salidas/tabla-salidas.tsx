import Link from "next/link";
import { BadgeDevolucion, BadgeEstatusSalida } from "@/components/salidas/estatus-salida";
import type { FilaSalida } from "@/components/salidas/filas";
import { Badge, Estados } from "@/components/ui/superficies";
import { Tabla, Td, Th, Tr } from "@/components/ui/tabla";

export function TablaSalidas({ filas }: { filas: FilaSalida[] }) {
  return (
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
        {filas.map((s) => (
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
              <Estados>
                <BadgeEstatusSalida estatus={s.estatus} />
                {s.prestamo && <Badge>Préstamo</Badge>}
                {s.devolucion && <BadgeDevolucion estado={s.devolucion} />}
                {s.revertida && <Badge tono="peligro">Revertida</Badge>}
              </Estados>
            </Td>
          </Tr>
        ))}
      </tbody>
    </Tabla>
  );
}
