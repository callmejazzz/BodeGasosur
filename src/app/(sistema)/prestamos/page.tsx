import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { Badge, Card, EncabezadoPagina, EstadoVacio } from "@/components/ui/superficies";
import { Tabla, Td, Th, Tr } from "@/components/ui/tabla";
import { consultar } from "@/lib/db";
import { formatearFecha } from "@/lib/fechas";
import { listarPrestamos, type EstadoPrestamo } from "@/lib/inventario/repo";
import { usuarioTienePermiso } from "@/lib/permisos";
import { cantidad } from "@/lib/utils";

export const dynamic = "force-dynamic";

const ESTADOS: { valor: EstadoPrestamo; etiqueta: string }[] = [
  { valor: "abiertos", etiqueta: "Abiertos" },
  { valor: "cerrados", etiqueta: "Cerrados" },
  { valor: "todos", etiqueta: "Todos" },
];

export default async function PaginaPrestamos({ searchParams }: PageProps<"/prestamos">) {
  const { estado: crudo } = await searchParams;
  const estado = ESTADOS.find((e) => e.valor === crudo)?.valor ?? "abiertos";
  // Préstamo es una salida; lo que vuelve es una devolución: se piden los dos permisos de lectura.
  const { prestamos, puedeDevolver } = await consultar("devoluciones:leer", async (db, usuario) => {
    if (!usuarioTienePermiso(usuario, "salidas:leer")) return { prestamos: [], puedeDevolver: false };
    return { prestamos: await listarPrestamos(db, estado), puedeDevolver: usuarioTienePermiso(usuario, "devoluciones:capturar") };
  });

  return (
    <>
      <EncabezadoPagina
        titulo="Préstamos"
        descripcion="Salidas marcadas como préstamo. Siguen abiertas mientras falte cualquier pieza; solo las devoluciones ligadas a la salida reducen lo pendiente."
        acciones={<ButtonLink href="/devoluciones" variante="secundario">Devoluciones</ButtonLink>}
      />
      <Card>
        <nav aria-label="Estado" className="flex gap-2 border-b border-border px-5 py-3 text-sm">
          {ESTADOS.map((e) => (
            <Link key={e.valor} href={`/prestamos?estado=${e.valor}`} className={e.valor === estado ? "font-semibold text-foreground" : "text-primary hover:underline"}>
              {e.etiqueta}
            </Link>
          ))}
        </nav>
        {prestamos.length === 0 ? (
          <EstadoVacio titulo={estado === "abiertos" ? "No hay préstamos pendientes" : "No hay préstamos en esta vista"} />
        ) : (
          <Tabla>
            <thead>
              <tr>
                <Th>Salida</Th>
                <Th>Fecha</Th>
                <Th>Estación</Th>
                <Th>Bodega</Th>
                <Th className="text-right">Salió</Th>
                <Th className="text-right">Volvió</Th>
                <Th className="text-right">Falta</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {prestamos.map((p) => (
                <Tr key={p.id}>
                  <Td className="whitespace-nowrap">
                    <Link href={`/salidas/${p.id}`} className="font-medium text-primary hover:underline">{p.folio}</Link>
                  </Td>
                  <Td className="whitespace-nowrap">{formatearFecha(p.fecha)}</Td>
                  <Td>{p.estacion}</Td>
                  <Td>{p.bodega}</Td>
                  <Td className="text-right tabular">{cantidad(p.retirado)}</Td>
                  <Td className="text-right tabular">{cantidad(p.devuelto)}</Td>
                  <Td className="text-right tabular">{p.pendiente > 0 ? cantidad(p.pendiente) : <Badge tono="exito">Cerrado</Badge>}</Td>
                  <Td className="text-right">
                    {puedeDevolver && p.pendiente > 0 && (
                      <Link href={`/devoluciones/nueva?salida=${p.id}`} prefetch={false} className="text-sm text-primary hover:underline">
                        Registrar devolución
                      </Link>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Tabla>
        )}
      </Card>
    </>
  );
}
