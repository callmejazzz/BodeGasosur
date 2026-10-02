import { randomUUID } from "node:crypto";
import { crearDevolucion } from "../actions";
import { FormularioDevolucion, type ValoresDevolucion } from "@/components/inventario/formulario-devolucion";
import { Card, CardHeader, EncabezadoPagina, EstadoVacio } from "@/components/ui/superficies";
import { consultar, SinPermiso } from "@/lib/db";
import { opcionesDeCaptura } from "@/lib/inventario/pantallas";

export const dynamic = "force-dynamic";

export default async function PaginaNuevaDevolucion({ searchParams }: PageProps<"/devoluciones/nueva">) {
  let opciones;
  try {
    opciones = await consultar("devoluciones:capturar", (db) => opcionesDeCaptura(db, "DEVOLUCION"));
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

  // Desde una salida o un préstamo: solo se precarga si sigue siendo devolvible.
  const { salida } = await searchParams;
  const vinculada = opciones.salidas.find((s) => s.id === salida);
  const valores: ValoresDevolucion | undefined = vinculada && {
    estacionId: vinculada.estacionId,
    salidaId: vinculada.id,
    bodegaDestinoId: vinculada.bodega.id,
    observaciones: "",
    partidas: Object.entries(vinculada.pendientes).map(([articuloId, pendiente]) => ({ articuloId, presentacion: "UNIDAD", cantidadCapturada: String(pendiente), observaciones: "" })),
  };

  return (
    <>
      <EncabezadoPagina titulo="Nueva devolución" descripcion="Se guarda como borrador: no suma existencia ni reduce el préstamo hasta que se confirme." />
      <Card>
        <CardHeader titulo="Material que vuelve de una estación" descripcion="Con salida vinculada, cada artículo se limita a lo que falta por volver." />
        <FormularioDevolucion opciones={opciones} accion={crearDevolucion} llaveIdempotencia={randomUUID()} valores={valores} textoGuardar="Guardar borrador" cancelarHref="/devoluciones" />
      </Card>
    </>
  );
}
