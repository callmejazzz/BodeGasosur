import { filaDeMovimiento } from "@/components/inventario/filas";
import { FiltrosMovimientos } from "@/components/inventario/filtros-movimientos";
import { TablaMovimientos } from "@/components/inventario/tabla-movimientos";
import { ButtonLink } from "@/components/ui/button";
import { Card, EncabezadoPagina, EstadoVacio } from "@/components/ui/superficies";
import { consultar } from "@/lib/db";
import { aParametros, enlaceDeTramo, hayFiltros } from "@/lib/inventario/filtros";
import { datosDeLista } from "@/lib/inventario/pantallas";

export const dynamic = "force-dynamic";

export default async function PaginaAjustes({ searchParams }: PageProps<"/ajustes">) {
  const datos = await consultar("ajustes:leer", async (db, usuario) => datosDeLista(db, usuario, "AJUSTE", await searchParams));
  const { filtros, cursorActual, cursorSiguiente, hayMas } = datos;
  const filas = datos.filas.map(filaDeMovimiento);

  return (
    <>
      <EncabezadoPagina
        titulo="Ajustes"
        descripcion="Nacen al confirmar una hoja de conteo o al revertir un movimiento: no se capturan sueltos. Uno que suma crea capa sin costo; uno que resta consume PEPS."
        acciones={<ButtonLink href="/conteos" variante="secundario">Hojas de conteo</ButtonLink>}
      />
      <Card>
        <FiltrosMovimientos filtros={filtros} total={filas.length} tramo={hayMas || !!cursorActual} sustantivo={["ajuste", "ajustes"]} />
        {filas.length === 0 ? (
          <EstadoVacio titulo={hayFiltros(filtros) ? "Sin coincidencias" : "Todavía no hay ajustes"} />
        ) : (
          <TablaMovimientos
            key={`${aParametros(filtros)}:${cursorActual ?? ""}`}
            ruta="/ajustes"
            filas={filas}
            columnas={["origen", "destino", "detalle"]}
            siguienteHref={cursorSiguiente ? enlaceDeTramo("/ajustes", filtros, cursorSiguiente) : null}
            inicioHref={cursorActual ? enlaceDeTramo("/ajustes", filtros) : null}
          />
        )}
      </Card>
    </>
  );
}
