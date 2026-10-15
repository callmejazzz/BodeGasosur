import { FiltrosExistencias } from "@/components/reportes/filtros";
import { ContextoReporte, TablaReporte, ValorConocido } from "@/components/reportes/tabla-reporte";
import { DescargarExcel } from "@/components/ui/descargar-excel";
import { Paginacion } from "@/components/ui/paginacion";
import { Badge, Card, EncabezadoPagina, EstadoVacio } from "@/components/ui/superficies";
import { consultar } from "@/lib/db";
import { columnasExistencias } from "@/lib/reportes/columnas";
import { aParametrosExistencias } from "@/lib/reportes/filtros";
import { datosExistencias } from "@/lib/reportes/pantallas";
import { cantidad } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function PaginaExistencias({ searchParams }: PageProps<"/reportes/existencias">) {
  const d = await consultar("reportes:leer", async (db) => datosExistencias(db, await searchParams));
  const filtros = aParametrosExistencias(d.filtros);
  const { total } = d;

  return (
    <>
      <EncabezadoPagina
        titulo="Existencias por bodega"
        descripcion="Lo que hay hoy en cada bodega, su valor y el mínimo del artículo. Sin existencia, un artículo aparece si está bajo su mínimo o si se le busca."
        acciones={<DescargarExcel href={`/exportar/existencias?${filtros}`} />}
      />
      <Card>
        <FiltrosExistencias filtros={d.filtros} bodegas={d.opciones} total={d.lista.pagina.total} />
        <ContextoReporte
          filtros={[d.descripcion[0]]}
          generado={new Date()}
          aviso={total.bajoMinimo > 0 && <Badge tono="aviso">{`${cantidad(total.bajoMinimo)} bajo mínimo`}</Badge>}
        />
        {d.lista.filas.length === 0 ? (
          <EstadoVacio
            titulo={d.filtros.bajoMinimo ? "Nada está bajo su mínimo" : "Sin existencias que mostrar"}
            descripcion="Prueba con otra bodega u otra búsqueda. Un artículo sin existencia ni mínimo se encuentra buscándolo."
          />
        ) : (
          <TablaReporte columnas={columnasExistencias(d.hoy)} filas={d.lista.filas} />
        )}
        <Paginacion pagina={d.lista.pagina} ruta="/reportes/existencias" parametros={filtros} sustantivo="filas" />
        {total.filas > 0 && (
          <ValorConocido
            importe={total.importe}
            importeConIva={total.importeConIva}
            sinCosto={total.filasSinCosto > 0 ? `${cantidad(total.filasSinCosto)} de ${cantidad(total.filas)} filas tienen piezas sin costo, fuera de este importe.` : null}
          />
        )}
      </Card>
    </>
  );
}
