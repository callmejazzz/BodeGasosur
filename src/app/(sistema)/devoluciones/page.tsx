import { filaDeMovimiento } from "@/components/inventario/filas";
import { FiltrosMovimientos } from "@/components/inventario/filtros-movimientos";
import { TablaMovimientos } from "@/components/inventario/tabla-movimientos";
import { ButtonLink } from "@/components/ui/button";
import { Paginacion } from "@/components/ui/paginacion";
import { Card, EncabezadoPagina, EstadoVacio } from "@/components/ui/superficies";
import { consultar } from "@/lib/db";
import { aParametros, hayFiltros } from "@/lib/inventario/filtros";
import { datosDeLista } from "@/lib/inventario/pantallas";

export const dynamic = "force-dynamic";

export default async function PaginaDevoluciones({ searchParams }: PageProps<"/devoluciones">) {
  const datos = await consultar("devoluciones:leer", async (db, usuario) => datosDeLista(db, usuario, "DEVOLUCION", await searchParams));
  const { filtros, pagina, puedeCapturar } = datos;
  const filas = datos.filas.map(filaDeMovimiento);
  const filtrando = hayFiltros(filtros);

  return (
    <>
      <EncabezadoPagina
        titulo="Devoluciones"
        descripcion="Material que vuelve de una estación. Ligada a su salida hereda el costo y reduce el préstamo; sin salida entra sin costo."
        acciones={
          <>
            <ButtonLink href="/prestamos" variante="secundario">Préstamos</ButtonLink>
            {puedeCapturar && <ButtonLink href="/devoluciones/nueva" prefetch={false}>Nueva devolución</ButtonLink>}
          </>
        }
      />
      <Card>
        <FiltrosMovimientos filtros={filtros} total={pagina.total} sustantivo={["devolución", "devoluciones"]} />
        {filas.length === 0 ? (
          <EstadoVacio
            titulo={filtrando ? "Sin coincidencias" : "Todavía no hay devoluciones"}
            descripcion={filtrando ? "Prueba con otra búsqueda o cambia el filtro." : undefined}
          />
        ) : (
          <TablaMovimientos ruta="/devoluciones" filas={filas} columnas={["estacion", "destino", "detalle"]} />
        )}
        <Paginacion pagina={pagina} ruta="/devoluciones" parametros={aParametros(filtros)} sustantivo="devoluciones" />
      </Card>
    </>
  );
}
