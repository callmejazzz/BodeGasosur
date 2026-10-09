import { filaDeSalida } from "@/components/salidas/filas";
import { FiltrosSalidas } from "@/components/salidas/filtros-salidas";
import { TablaSalidas } from "@/components/salidas/tabla-salidas";
import { ButtonLink } from "@/components/ui/button";
import { Paginacion } from "@/components/ui/paginacion";
import { Card, EncabezadoPagina, EstadoVacio } from "@/components/ui/superficies";
import { consultar } from "@/lib/db";
import { aParametros, hayFiltros } from "@/lib/salidas/filtros";
import { datosDeLista } from "@/lib/salidas/pantallas";

export const dynamic = "force-dynamic";

export default async function PaginaSalidas({ searchParams }: PageProps<"/salidas">) {
  // Sesión y permiso primero; los filtros se leen ya dentro de la puerta.
  const { filtros, filas: resumen, devoluciones, pagina, puedeCapturar, pendientes } = await consultar("salidas:leer", async (db, usuario) =>
    datosDeLista(db, usuario, await searchParams),
  );
  const filtrando = hayFiltros(filtros);
  const filas = resumen.map((s) => filaDeSalida(s, devoluciones[s.id]));

  return (
    <>
      <EncabezadoPagina
        titulo="Salidas"
        descripcion="El folio se asigna al registrar el retiro; en ese momento se descuenta inventario por capas PEPS."
        acciones={
          <>
            {pendientes !== null && (
              <ButtonLink href="/salidas/pendientes" variante="secundario">
                Pendientes ({pendientes})
              </ButtonLink>
            )}
            {puedeCapturar && (
              <ButtonLink href="/salidas/nueva" prefetch={false}>
                Nueva salida
              </ButtonLink>
            )}
          </>
        }
      />

      <Card>
        <FiltrosSalidas filtros={filtros} total={pagina.total} />

        {filas.length === 0 ? (
          <EstadoVacio
            titulo={filtrando ? "Sin coincidencias" : "Todavía no hay salidas"}
            descripcion={
              filtrando
                ? "Prueba con otra búsqueda o cambia el filtro."
                : puedeCapturar
                  ? "Captura la primera solicitud de material para empezar."
                  : "Nadie ha solicitado ninguna todavía."
            }
            accion={!filtrando && puedeCapturar ? <ButtonLink href="/salidas/nueva" tamano="sm" prefetch={false}>Nueva salida</ButtonLink> : undefined}
          />
        ) : (
          <TablaSalidas filas={filas} />
        )}
        <Paginacion pagina={pagina} ruta="/salidas" parametros={aParametros(filtros)} sustantivo="salidas" />
      </Card>
    </>
  );
}
