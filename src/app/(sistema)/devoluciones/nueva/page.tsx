import { randomUUID } from "node:crypto";
import { crearDevolucion } from "../actions";
import { buscarSalidas } from "../consultas";
import { FormularioDevolucion, type ValoresDevolucion } from "@/components/inventario/formulario-devolucion";
import { Card, CardHeader, EncabezadoPagina, EstadoVacio } from "@/components/ui/superficies";
import { consultar, SinPermiso } from "@/lib/db";
import { opcionesDeCaptura, salidaDelEnlace } from "@/lib/inventario/pantallas";

export const dynamic = "force-dynamic";

export default async function PaginaNuevaDevolucion({ searchParams }: PageProps<"/devoluciones/nueva">) {
  let datos;
  try {
    // Desde una salida o un préstamo (?salida=…): se consulta y se valida ya dentro de la puerta.
    datos = await consultar("devoluciones:capturar", async (db) => ({
      opciones: await opcionesDeCaptura(db, "DEVOLUCION"),
      vinculada: await salidaDelEnlace(db, (await searchParams).salida),
    }));
  } catch (error) {
    if (!(error instanceof SinPermiso)) throw error;
    return (
      <>
        <EncabezadoPagina titulo="Nueva devolución" />
        <Card className="max-w-3xl">
          <EstadoVacio titulo="No puedes capturar devoluciones" descripcion="Tu cuenta permite consultarlas, no capturarlas." />
        </Card>
      </>
    );
  }

  const { opciones, vinculada } = datos;
  const s = vinculada.salida;
  // La salida del enlace propone todo lo que falta por volver.
  const valores: ValoresDevolucion | undefined = s
    ? {
        estacionId: s.estacion.id,
        bodegaDestinoId: s.bodega.id,
        observaciones: "",
        partidas: Object.entries(s.pendientes).map(([articuloId, pendiente]) => ({ articuloId, presentacion: "UNIDAD", cantidadCapturada: String(pendiente), observaciones: "" })),
      }
    : undefined;

  return (
    <>
      <EncabezadoPagina titulo="Nueva devolución" descripcion="Se guarda como borrador: no suma existencia ni reduce el préstamo hasta que se confirme." />
      <Card>
        <CardHeader titulo="Material que vuelve de una estación" descripcion="Con salida vinculada, cada artículo se limita a lo que falta por volver." />
        <FormularioDevolucion
          opciones={opciones}
          vinculada={vinculada}
          buscar={buscarSalidas}
          accion={crearDevolucion}
          llaveIdempotencia={randomUUID()}
          valores={valores}
          textoGuardar="Guardar borrador"
          cancelarHref="/devoluciones"
        />
      </Card>
    </>
  );
}
