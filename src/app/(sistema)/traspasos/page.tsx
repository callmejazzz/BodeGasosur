import { filaDeMovimiento } from "@/components/inventario/filas";
import { FiltrosMovimientos } from "@/components/inventario/filtros-movimientos";
import { TablaMovimientos } from "@/components/inventario/tabla-movimientos";
import { ButtonLink } from "@/components/ui/button";
import { Card, EncabezadoPagina, EstadoVacio } from "@/components/ui/superficies";
import { consultar } from "@/lib/db";
import { aParametros, enlaceDeTramo, hayFiltros } from "@/lib/inventario/filtros";
import { datosDeLista } from "@/lib/inventario/pantallas";

export const dynamic = "force-dynamic";

export default async function PaginaTraspasos({ searchParams }: PageProps<"/traspasos">) {
  // Sesión y permiso primero; los filtros se leen ya dentro de la puerta.
  const datos = await consultar("traspasos:leer", async (db, usuario) => datosDeLista(db, usuario, "TRASPASO", await searchParams));
  const { filtros, cursorActual, cursorSiguiente, hayMas, puedeCapturar } = datos;
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
        <FiltrosMovimientos filtros={filtros} total={filas.length} tramo={hayMas || !!cursorActual} sustantivo={["traspaso", "traspasos"]} />
        {filas.length === 0 ? (
          <EstadoVacio
            titulo={cursorActual ? "No quedan traspasos en este tramo" : filtrando ? "Sin coincidencias" : "Todavía no hay traspasos"}
            descripcion={filtrando ? "Prueba con otra búsqueda o cambia el filtro." : undefined}
            accion={!filtrando && !cursorActual && puedeCapturar ? <ButtonLink href="/traspasos/nuevo" tamano="sm" prefetch={false}>Nuevo traspaso</ButtonLink> : undefined}
          />
        ) : (
          <TablaMovimientos
            key={`${aParametros(filtros)}:${cursorActual ?? ""}`}
            ruta="/traspasos"
            filas={filas}
            columnas={["origen", "destino", "detalle"]}
            siguienteHref={cursorSiguiente ? enlaceDeTramo("/traspasos", filtros, cursorSiguiente) : null}
            inicioHref={cursorActual ? enlaceDeTramo("/traspasos", filtros) : null}
          />
        )}
      </Card>
    </>
  );
}
