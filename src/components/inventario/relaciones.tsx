import Link from "next/link";
import type { ReactNode } from "react";
import { EnlaceMovimiento } from "@/components/inventario/detalle-movimiento";
import { Badge } from "@/components/ui/superficies";
import { Tabla, Td, Th, Tr } from "@/components/ui/tabla";
import { formatearFecha, formatearInstante } from "@/lib/fechas";
import type { SaldoDeArticulo } from "@/lib/inventario/primitivas";
import type { rutaDeMovimiento } from "@/lib/inventario/repo";
import { cantidad } from "@/lib/utils";

type Reversa = { id: string; folio: string | null; tipo: Parameters<typeof rutaDeMovimiento>[0]; motivo: string | null; confirmadoEn: Date | null; creadoPor: { correo: string } };

/** El original no cambia de estatus: la reversa se muestra como relación. */
export function AvisoDeReversa({ reversa }: { reversa: Reversa }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border bg-danger-soft/40 px-5 py-3 text-sm">
      <Badge tono="peligro">Revertido</Badge>
      <span>
        Con <EnlaceMovimiento m={reversa} />
        {reversa.motivo && <>: {reversa.motivo}</>}
        <span className="text-muted"> · {reversa.creadoPor.correo}{reversa.confirmadoEn && `, ${formatearInstante(reversa.confirmadoEn)}`}</span>
      </span>
    </div>
  );
}

type Devolucion = { id: string; folio: string | null; estatus: string; fecha: Date; canceladoPor: { id: string; folio: string | null } | null };

/**
 * Lo que salió, lo que ya volvió en devoluciones vigentes y lo que falta, por
 * artículo. `saldo` y `devoluciones` son la página que se ve; `abierto` mira
 * toda la salida. Cada pie es la paginación de su lista.
 */
export function SaldoDeSalida({
  salidaId,
  saldo,
  abierto,
  devoluciones,
  esPrestamo,
  puedeDevolver,
  pieSaldo,
  pieDevoluciones,
}: {
  salidaId: string;
  saldo: SaldoDeArticulo[];
  abierto: boolean;
  devoluciones: Devolucion[];
  esPrestamo: boolean;
  puedeDevolver: boolean;
  pieSaldo?: ReactNode;
  pieDevoluciones?: ReactNode;
}) {
  return (
    <>
      <Tabla>
        <thead>
          <tr>
            <Th>Artículo</Th>
            <Th className="text-right">Salió</Th>
            <Th className="text-right">Volvió</Th>
            <Th className="text-right">Falta</Th>
          </tr>
        </thead>
        <tbody>
          {saldo.map((s) => (
            <Tr key={s.articuloId}>
              <Td><span className="font-medium">{s.clave}</span> <span className="text-muted">{s.descripcion}</span></Td>
              <Td className="text-right tabular">{cantidad(s.retirado)} {s.unidad}</Td>
              <Td className="text-right tabular">{cantidad(s.devuelto)} {s.unidad}</Td>
              <Td className="text-right tabular">{cantidad(s.pendiente)} {s.unidad}</Td>
            </Tr>
          ))}
        </tbody>
      </Tabla>
      {pieSaldo}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-sm">
        <span className="flex flex-wrap items-center gap-3">
          {esPrestamo && (abierto ? <Badge tono="aviso">Préstamo abierto</Badge> : <Badge tono="exito">Préstamo cerrado</Badge>)}
          {devoluciones.length === 0 ? (
            <span className="text-muted">Sin devoluciones.</span>
          ) : (
            devoluciones.map((d) => (
              <span key={d.id} className="flex items-center gap-1.5">
                <Link href={`/devoluciones/${d.id}`} className="font-medium text-primary hover:underline">{d.folio ?? "Borrador"}</Link>
                <span className="text-muted">{formatearFecha(d.fecha)}</span>
                {d.canceladoPor && <Badge tono="peligro">Revertida</Badge>}
              </span>
            ))
          )}
        </span>
        {puedeDevolver && abierto && (
          <Link href={`/devoluciones/nueva?salida=${salidaId}`} prefetch={false} className="font-medium text-primary hover:underline">
            Registrar devolución
          </Link>
        )}
      </div>
      {pieDevoluciones}
    </>
  );
}
