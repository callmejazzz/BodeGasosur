import { FiltrosEntradas } from "@/components/entradas/filtros-entradas";
import { TablaEntradas, type FilaEntrada } from "@/components/entradas/tabla-entradas";
import { ButtonLink } from "@/components/ui/button";
import { Card, EncabezadoPagina, EstadoVacio } from "@/components/ui/superficies";
import { consultar } from "@/lib/db";
import { aParametros, hayFiltros, leerFiltros } from "@/lib/entradas/filtros";
import { listarEntradas } from "@/lib/entradas/repo";
import { formatearFecha } from "@/lib/fechas";
import { rolTienePermiso } from "@/lib/permisos";
import { moneda } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function PaginaEntradas({ searchParams }: PageProps<"/entradas">) {
  const filtros = leerFiltros(await searchParams);
  const filtrando = hayFiltros(filtros);

  const { lista, puedeCapturar } = await consultar("entradas:leer", async (db, usuario) => ({
    lista: await listarEntradas(db, filtros),
    puedeCapturar: rolTienePermiso(usuario.rol, "entradas:capturar"),
  }));
  const { hayMas } = lista;
  // Al cliente viaja texto ya formateado: nada de Decimal ni Date en las props.
  const filas: FilaEntrada[] = lista.filas.map((e) => ({
    id: e.id,
    folio: e.folio,
    estatus: e.estatus,
    fecha: formatearFecha(e.fecha),
    proveedor: e.proveedor?.nombreComercial ?? "—",
    referencia: e.referencia,
    bodega: e.bodegaDestino?.nombre ?? "—",
    partidas: e._count.partidas,
    total: e.total === null ? "—" : e.moneda === "USD" ? `${Number(String(e.total)).toFixed(2)} USD` : moneda(e.total),
  }));

  return (
    <>
      <EncabezadoPagina
        titulo="Entradas"
        descripcion="Material que llega de un proveedor a una bodega. Un borrador no afecta existencias; confirmar la recepción asigna folio y crea las capas de costo."
        acciones={
          puedeCapturar ? (
            <ButtonLink href="/entradas/nueva" prefetch={false}>
              Nueva entrada
            </ButtonLink>
          ) : undefined
        }
      />

      <Card>
        <FiltrosEntradas filtros={filtros} total={filas.length} hayMas={hayMas} />

        {filas.length === 0 ? (
          <EstadoVacio
            titulo={filtrando ? "Sin coincidencias" : "Todavía no hay entradas"}
            descripcion={
              filtrando
                ? "Prueba con otra búsqueda o cambia el filtro."
                : puedeCapturar
                  ? "Captura la primera recepción de material para empezar."
                  : "Nadie ha capturado ninguna todavía."
            }
            accion={
              !filtrando && puedeCapturar ? (
                <ButtonLink href="/entradas/nueva" tamano="sm" prefetch={false}>Nueva entrada</ButtonLink>
              ) : undefined
            }
          />
        ) : (
          <TablaEntradas key={aParametros(filtros).toString()} filas={filas} hayMas={hayMas} />
        )}
      </Card>
    </>
  );
}
