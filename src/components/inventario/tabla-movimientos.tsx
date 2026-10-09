import Link from "next/link";
import { BadgeEstatus } from "@/components/inventario/estatus";
import type { FilaMovimiento } from "@/components/inventario/filas";
import { Tabla, Td, Th, Tr } from "@/components/ui/tabla";

type Columna = "origen" | "destino" | "estacion" | "detalle";

const ETIQUETAS: Record<Columna, string> = { origen: "Bodega origen", destino: "Bodega destino", estacion: "Estación", detalle: "Detalle" };

export function TablaMovimientos({ ruta, filas, columnas }: { ruta: string; filas: FilaMovimiento[]; columnas: Columna[] }) {
  return (
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
        {filas.map((m) => (
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
  );
}
