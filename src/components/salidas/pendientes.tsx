import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/superficies";
import { Tabla, Td, Th, Tr } from "@/components/ui/tabla";
import { formatearInstante } from "@/lib/fechas";
import { listaDeEstatus } from "@/lib/salidas/filtros";
import type { ClaveSeccion, SalidaResumen, SeccionBandeja } from "@/lib/salidas/repo";

const SECCION: Record<ClaveSeccion, { titulo: string; descripcion: string; desde: (s: SalidaResumen) => Date | null }> = {
  porAutorizar: {
    titulo: "Por autorizar",
    descripcion: "Solicitudes que esperan que alguien facultado las autorice o las rechace.",
    desde: (s) => s.createdAt,
  },
  porRetirar: {
    titulo: "Por retirar",
    descripcion: "Autorizadas: falta registrar la salida física de la bodega.",
    desde: (s) => s.autorizadoEn,
  },
  porRecibir: {
    titulo: "Por confirmar recepción",
    descripcion: "Retiradas: falta confirmar que la estación recibió el material.",
    desde: (s) => s.entregadoEn,
  },
};

export function SeccionPendientes({ seccion }: { seccion: SeccionBandeja }) {
  const { titulo, descripcion, desde } = SECCION[seccion.clave];
  return (
    <Card>
      <CardHeader titulo={`${titulo} (${seccion.total})`} descripcion={descripcion} />
      {seccion.filas.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted">Nada pendiente.</p>
      ) : (
        <>
          <Tabla>
            <thead>
              <tr>
                <Th>Salida</Th>
                <Th>Espera desde</Th>
                <Th>Bodega origen</Th>
                <Th>Estación</Th>
                <Th>Solicitante</Th>
                <Th className="text-right">Partidas</Th>
              </tr>
            </thead>
            <tbody>
              {seccion.filas.map((s) => {
                const cuando = desde(s);
                return (
                  <Tr key={s.id}>
                    <Td className="whitespace-nowrap">
                      <Link href={`/salidas/${s.id}`} className="font-medium text-primary hover:underline">
                        {s.folio ?? "Sin folio"}
                      </Link>
                      {s.esPrestamo && <span className="ml-2 text-xs text-muted">préstamo</span>}
                    </Td>
                    <Td className="tabular whitespace-nowrap">{cuando ? formatearInstante(cuando) : "—"}</Td>
                    <Td>{s.bodegaOrigen?.nombre ?? "—"}</Td>
                    <Td>{s.estacion?.alias ?? "—"}</Td>
                    <Td>{s.solicitadoPor?.nombre ?? <span className="text-muted">—</span>}</Td>
                    <Td className="text-right tabular">{s._count.partidas}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </Tabla>
          {seccion.total > seccion.filas.length && (
            <p className="border-t border-border px-5 py-3 text-sm text-muted">
              Se muestran las {seccion.filas.length} más antiguas.{" "}
              <Link href={listaDeEstatus(seccion.estatus)} className="text-primary hover:underline">
                Ver las {seccion.total} en la lista
              </Link>
            </p>
          )}
        </>
      )}
    </Card>
  );
}
