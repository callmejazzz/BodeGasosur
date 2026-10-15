import { FiltrosSemanal } from "@/components/reportes/filtros";
import { ContextoReporte, TablaReporte, ValorConocido } from "@/components/reportes/tabla-reporte";
import { DescargarExcel } from "@/components/ui/descargar-excel";
import { Paginacion } from "@/components/ui/paginacion";
import { Badge, Card, CardHeader, EncabezadoPagina, EstadoVacio } from "@/components/ui/superficies";
import { consultar } from "@/lib/db";
import { parametrosDePaginas } from "@/lib/paginacion";
import { columnasSemanal, columnasTotalesSemanal } from "@/lib/reportes/columnas";
import { aParametrosSemanal } from "@/lib/reportes/filtros";
import { datosSemanal } from "@/lib/reportes/pantallas";
import { cantidad } from "@/lib/utils";

export const dynamic = "force-dynamic";

const juntar = (...listas: URLSearchParams[]) => new URLSearchParams(listas.flatMap((p) => [...p]));

export default async function PaginaSemanal({ searchParams }: PageProps<"/reportes/semanal">) {
  const d = await consultar("reportes:leer", async (db) => datosSemanal(db, await searchParams));
  const filtros = aParametrosSemanal(d.filtros);
  const paginas = parametrosDePaginas({ pagina: d.lista.pagina, articulos: d.porArticulo?.pagina });
  const { total } = d;

  return (
    <>
      <EncabezadoPagina
        titulo="Reporte semanal"
        descripcion="Del sábado al viernes, por artículo y bodega: saldo inicial, cada alta y baja de la semana, saldo final y su valor. Se calcula al consultarlo con el libro de movimientos."
        acciones={<DescargarExcel href={`/exportar/semanal?${filtros}`} />}
      />
      <Card>
        <FiltrosSemanal filtros={d.filtros} bodegas={d.opciones} total={d.lista.pagina.total} />
        <ContextoReporte
          filtros={d.descripcion.filter(([e]) => e === "Semana" || e === "Corte")}
          generado={new Date()}
          aviso={d.provisional && <Badge tono="aviso">Provisional: el viernes aún no termina</Badge>}
        />
        {d.lista.filas.length === 0 ? (
          <EstadoVacio titulo="Sin movimientos ni saldo en esta semana" descripcion="Prueba con otra semana, otra bodega u otra búsqueda." />
        ) : (
          <TablaReporte columnas={columnasSemanal(d.semana)} filas={d.lista.filas} />
        )}
        <Paginacion pagina={d.lista.pagina} ruta="/reportes/semanal" parametros={juntar(filtros, paginas)} sustantivo="filas" />
        {total.filas > 0 && (
          <ValorConocido
            etiqueta="Valor final"
            importe={total.importe}
            importeConIva={total.importeConIva}
            sinCosto={total.filasSinCosto > 0 ? `${cantidad(total.filasSinCosto)} de ${cantidad(total.filas)} filas tienen piezas sin costo, fuera de este importe.` : null}
          />
        )}
      </Card>

      {d.porArticulo && d.porArticulo.pagina.total > 0 && (
        <Card id="articulos" className="mt-6 scroll-mt-4">
          <CardHeader titulo="Totales por artículo" descripcion="Todas las bodegas juntas, cada artículo en su unidad. Los traspasos entre bodegas se compensan." />
          <TablaReporte columnas={columnasTotalesSemanal(d.semana)} filas={d.porArticulo.filas} />
          <Paginacion pagina={d.porArticulo.pagina} ruta="/reportes/semanal" parametros={juntar(filtros, paginas)} parametro="articulos" ancla="articulos" sustantivo="artículos" />
        </Card>
      )}
    </>
  );
}
