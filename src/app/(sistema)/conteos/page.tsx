import Link from "next/link";
import { FiltrosMovimientos } from "@/components/inventario/filtros-movimientos";
import { BadgeEstatus } from "@/components/inventario/estatus";
import { ButtonLink } from "@/components/ui/button";
import { Card, EncabezadoPagina, EstadoVacio } from "@/components/ui/superficies";
import { Tabla, Td, Th, Tr } from "@/components/ui/tabla";
import { consultar } from "@/lib/db";
import { formatearInstante } from "@/lib/fechas";
import { enlaceDeTramo } from "@/lib/inventario/filtros";
import { datosDeListaHojas } from "@/lib/inventario/pantallas";

export const dynamic = "force-dynamic";

export default async function PaginaConteos({ searchParams }: PageProps<"/conteos">) {
  const { filtros, filas, hayMas, cursorActual, cursorSiguiente, puedeCapturar } = await consultar("ajustes:leer", async (db, usuario) =>
    datosDeListaHojas(db, usuario, await searchParams),
  );

  return (
    <>
      <EncabezadoPagina
        titulo="Conteo físico"
        descripcion="Hojas de conteo por bodega. Al confirmar, las diferencias se vuelven ajustes: una capa sin costo para lo que sobra, consumo PEPS para lo que falta."
        acciones={
          <>
            <ButtonLink href="/ajustes" variante="secundario">Ajustes</ButtonLink>
            {puedeCapturar && <ButtonLink href="/conteos/nuevo" prefetch={false}>Nueva hoja</ButtonLink>}
          </>
        }
      />
      <Card>
        <FiltrosMovimientos filtros={filtros} total={filas.length} tramo={hayMas || !!cursorActual} sustantivo={["hoja", "hojas"]} busqueda={false} fechas />
        {filas.length === 0 ? (
          <EstadoVacio titulo="No hay hojas de conteo en esta vista" />
        ) : (
          <Tabla>
            <thead>
              <tr>
                <Th>Abierta</Th>
                <Th>Bodega</Th>
                <Th>Motivo</Th>
                <Th className="text-right">Artículos</Th>
                <Th className="text-right">Ajustes</Th>
                <Th>Estatus</Th>
              </tr>
            </thead>
            <tbody>
              {filas.map((h) => (
                <Tr key={h.id}>
                  <Td className="whitespace-nowrap">
                    <Link href={`/conteos/${h.id}`} className="font-medium text-primary hover:underline">{formatearInstante(h.createdAt)}</Link>
                  </Td>
                  <Td>{h.bodega.nombre}</Td>
                  <Td className="max-w-72 truncate">{h.motivo}</Td>
                  <Td className="text-right tabular">{h._count.renglones}</Td>
                  <Td className="text-right tabular">{h._count.ajustes}</Td>
                  <Td><BadgeEstatus estatus={h.estatus} /></Td>
                </Tr>
              ))}
            </tbody>
          </Tabla>
        )}
        {(cursorActual || cursorSiguiente) && (
          <nav aria-label="Tramos" className="flex justify-between border-t border-border px-5 py-3 text-sm">
            {cursorActual ? <Link href={enlaceDeTramo("/conteos", filtros)} className="text-primary hover:underline">Volver a las más recientes</Link> : <span />}
            {cursorSiguiente && <Link href={enlaceDeTramo("/conteos", filtros, cursorSiguiente)} className="text-primary hover:underline">Ver anteriores</Link>}
          </nav>
        )}
      </Card>
    </>
  );
}
