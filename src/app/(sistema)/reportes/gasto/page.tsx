import { buscarArticulos } from "../consultas";
import { FiltrosGasto } from "@/components/reportes/filtros";
import { ContextoReporte, TablaReporte, ValorConocido } from "@/components/reportes/tabla-reporte";
import { DescargarExcel } from "@/components/ui/descargar-excel";
import { Paginacion } from "@/components/ui/paginacion";
import { Card, EncabezadoPagina, EstadoVacio } from "@/components/ui/superficies";
import { consultar } from "@/lib/db";
import { columnasGastoDetalle, columnasGastoEstacion } from "@/lib/reportes/columnas";
import { aParametrosGasto } from "@/lib/reportes/filtros";
import { datosGasto } from "@/lib/reportes/pantallas";

export const dynamic = "force-dynamic";

export default async function PaginaGasto({ searchParams }: PageProps<"/reportes/gasto">) {
  const d = await consultar("reportes:leer", async (db) => datosGasto(db, await searchParams));
  const filtros = aParametrosGasto(d.filtros);
  const pagina = (d.detalle ?? d.estaciones)!.pagina;

  return (
    <>
      <EncabezadoPagina
        titulo="Gasto por estación"
        descripcion="Material consumido neto: lo retirado menos lo devuelto en devoluciones ligadas a su salida, con el costo con que salió. Los préstamos no son gasto. Una reversa compensa en su fecha."
        acciones={<DescargarExcel href={`/exportar/gasto?${filtros}`} />}
      />
      <Card>
        <FiltrosGasto filtros={d.filtros} articulo={d.articulo} estaciones={d.opciones} buscar={buscarArticulos} total={pagina.total} />
        <ContextoReporte filtros={[d.descripcion[0]]} generado={new Date()} />
        {pagina.total === 0 ? (
          <EstadoVacio titulo="Sin consumo en el periodo" descripcion="Prueba con otro periodo, otra estación u otro artículo." />
        ) : d.detalle ? (
          <TablaReporte columnas={columnasGastoDetalle} filas={d.detalle.filas} />
        ) : (
          <TablaReporte columnas={columnasGastoEstacion} filas={d.estaciones!.filas} />
        )}
        <Paginacion pagina={pagina} ruta="/reportes/gasto" parametros={filtros} sustantivo={d.detalle ? "filas" : "estaciones"} />
        {pagina.total > 0 && (
          <ValorConocido
            etiqueta="Gasto"
            importe={d.total.importe}
            importeConIva={d.total.importeConIva}
            sinCosto={d.total.conPiezasSinCosto ? "Hay piezas sin costo conocido: el importe es solo el valor conocido." : null}
          />
        )}
      </Card>
    </>
  );
}
