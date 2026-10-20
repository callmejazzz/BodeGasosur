import { buscarArticulos } from "../consultas";
import { FiltrosKardex } from "@/components/reportes/filtros";
import { ContextoReporte, TablaReporte } from "@/components/reportes/tabla-reporte";
import { DescargarExcel } from "@/components/ui/descargar-excel";
import { Paginacion } from "@/components/ui/paginacion";
import { Card, CardHeader, EncabezadoPagina, EstadoVacio } from "@/components/ui/superficies";
import { consultar } from "@/lib/db";
import { parametrosDePaginas } from "@/lib/paginacion";
import { columnasKardex, columnasResumenKardex } from "@/lib/reportes/columnas";
import { aParametrosKardex } from "@/lib/reportes/filtros";
import { datosKardex } from "@/lib/reportes/pantallas";

export const dynamic = "force-dynamic";

const juntar = (...listas: URLSearchParams[]) => new URLSearchParams(listas.flatMap((p) => [...p]));

export default async function PaginaKardex({ searchParams }: PageProps<"/reportes/kardex">) {
  const d = await consultar("reportes:leer", async (db) => datosKardex(db, await searchParams));
  const filtros = aParametrosKardex(d.filtros);
  const paginas = parametrosDePaginas({ pagina: d.lista?.pagina, bodegas: d.resumen?.pagina });

  return (
    <>
      <EncabezadoPagina
        titulo="Kardex"
        descripcion="Cada movimiento de un artículo en cada bodega, con el saldo corrido de esa bodega. Un traspaso sale de una y entra en otra; una reversa queda en su fecha, enlazada con el original."
        acciones={d.articulo && <DescargarExcel href={`/exportar/kardex?${filtros}`} />}
      />
      <Card>
        <FiltrosKardex filtros={d.filtros} articulo={d.articulo} bodegas={d.opciones} buscar={buscarArticulos} total={d.lista?.pagina.total} />
        {!d.lista ? (
          <EstadoVacio titulo="Elige un artículo" descripcion="El kardex se consulta por artículo: busca su clave o su descripción." />
        ) : (
          <>
            <ContextoReporte filtros={d.descripcion} generado={new Date()} />
            {d.lista.filas.length === 0 ? (
              <EstadoVacio titulo="Sin movimientos en el periodo" descripcion="El saldo de cada bodega está en el resumen." />
            ) : (
              <TablaReporte columnas={columnasKardex} filas={d.lista.filas} />
            )}
            <Paginacion pagina={d.lista.pagina} ruta="/reportes/kardex" parametros={juntar(filtros, paginas)} sustantivo="movimientos" />
          </>
        )}
      </Card>

      {d.resumen && (
        <Card id="bodegas" className="mt-6 scroll-mt-4">
          <CardHeader titulo="Saldos por bodega" descripcion="Saldo antes del periodo, lo que entró y salió en él y el saldo al final. Cada bodega con historia del artículo." />
          {d.resumen.filas.length === 0 ? (
            <EstadoVacio titulo="El artículo no tiene movimientos hasta esta fecha" />
          ) : (
            <TablaReporte columnas={columnasResumenKardex} filas={d.resumen.filas} />
          )}
          <Paginacion pagina={d.resumen.pagina} ruta="/reportes/kardex" parametros={juntar(filtros, paginas)} parametro="bodegas" ancla="bodegas" sustantivo="bodegas" />
        </Card>
      )}
    </>
  );
}
