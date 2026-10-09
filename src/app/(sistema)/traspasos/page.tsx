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

export default async function PaginaTraspasos({ searchParams }: PageProps<"/traspasos">) {
  // Sesión y permiso primero; los filtros se leen ya dentro de la puerta.
  const datos = await consultar("traspasos:leer", async (db, usuario) => datosDeLista(db, usuario, "TRASPASO", await searchParams));
  const { filtros, pagina, puedeCapturar } = datos;
  const filas = datos.filas.map(filaDeMovimiento);
  const filtrando = hayFiltros(filtros);

  return (
    <>
      <EncabezadoPagina
        titulo="Traspasos"
        descripcion="Movimientos entre bodegas. Al confirmar se consume PEPS en origen y el material llega a destino con su fecha original y su costo."
        acciones={puedeCapturar && <ButtonLink href="/traspasos/nuevo" prefetch={false}>Nuevo traspaso</ButtonLink>}
      />
      <Card>
        <FiltrosMovimientos filtros={filtros} total={pagina.total} sustantivo={["traspaso", "traspasos"]} />
        {filas.length === 0 ? (
          <EstadoVacio
            titulo={filtrando ? "Sin coincidencias" : "Todavía no hay traspasos"}
            descripcion={filtrando ? "Prueba con otra búsqueda o cambia el filtro." : undefined}
            accion={!filtrando && puedeCapturar ? <ButtonLink href="/traspasos/nuevo" tamano="sm" prefetch={false}>Nuevo traspaso</ButtonLink> : undefined}
          />
        ) : (
          <TablaMovimientos ruta="/traspasos" filas={filas} columnas={["origen", "destino", "detalle"]} />
        )}
        <Paginacion pagina={pagina} ruta="/traspasos" parametros={aParametros(filtros)} sustantivo="traspasos" />
      </Card>
    </>
  );
}
