import { FiltrosFrecuencia } from "@/components/reportes/filtros";
import { ContextoReporte, TablaReporte } from "@/components/reportes/tabla-reporte";
import { DescargarExcel } from "@/components/ui/descargar-excel";
import { Paginacion } from "@/components/ui/paginacion";
import { Card, EncabezadoPagina, EstadoVacio } from "@/components/ui/superficies";
import { consultar } from "@/lib/db";
import { columnasFrecuencia } from "@/lib/reportes/columnas";
import { aParametrosFrecuencia } from "@/lib/reportes/filtros";
import { datosFrecuencia } from "@/lib/reportes/pantallas";

export const dynamic = "force-dynamic";

export default async function PaginaFrecuencia({ searchParams }: PageProps<"/reportes/frecuencia">) {
  const d = await consultar("reportes:leer", async (db) => datosFrecuencia(db, await searchParams));
  const filtros = aParametrosFrecuencia(d.filtros);

  return (
    <>
      <EncabezadoPagina
        titulo="Frecuencia de consumo"
        descripcion="Cuántas salidas retiradas llevaron cada artículo. Una salida cuenta una vez por artículo; las revertidas dejan de contar y las devoluciones no restan retiros."
        acciones={<DescargarExcel href={`/exportar/frecuencia?${filtros}`} />}
      />
      <Card>
        <FiltrosFrecuencia filtros={d.filtros} estaciones={d.estaciones} bodegas={d.bodegas} total={d.lista.pagina.total} />
        <ContextoReporte filtros={[d.descripcion[0]]} generado={new Date()} />
        {d.lista.filas.length === 0 ? (
          <EstadoVacio titulo="Sin retiros en el periodo" descripcion="Prueba con otro periodo, otra estación, otra bodega u otra búsqueda." />
        ) : (
          <TablaReporte columnas={columnasFrecuencia(d.filtros)} filas={d.lista.filas} />
        )}
        <Paginacion pagina={d.lista.pagina} ruta="/reportes/frecuencia" parametros={filtros} sustantivo="artículos" />
      </Card>
    </>
  );
}
