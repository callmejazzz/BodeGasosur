import { randomUUID } from "node:crypto";
import { crearTraspaso } from "../actions";
import { FormularioTraspaso } from "@/components/inventario/formulario-traspaso";
import { Card, CardHeader, EncabezadoPagina, EstadoVacio } from "@/components/ui/superficies";
import { consultar, SinPermiso } from "@/lib/db";
import { opcionesDeCaptura } from "@/lib/inventario/pantallas";

export const dynamic = "force-dynamic";

export default async function PaginaNuevoTraspaso() {
  let opciones;
  try {
    // Sin permiso de captura no se lee ningún catálogo ni existencia.
    opciones = await consultar("traspasos:capturar", (db) => opcionesDeCaptura(db, "TRASPASO"));
  } catch (error) {
    if (!(error instanceof SinPermiso)) throw error;
    return (
      <>
        <EncabezadoPagina titulo="Nuevo traspaso" />
        <Card className="max-w-3xl">
          <EstadoVacio titulo="No puedes capturar traspasos" descripcion="Tu cuenta permite consultarlos, no capturarlos." />
        </Card>
      </>
    );
  }

  return (
    <>
      <EncabezadoPagina titulo="Nuevo traspaso" descripcion="Se guarda como borrador: no mueve existencias hasta que se confirme." />
      <Card>
        <CardHeader titulo="Traspaso entre bodegas" descripcion="Captura por unidad o por caja; el sistema convierte a la unidad base. La existencia que se muestra es informativa." />
        {/* La llave nace con el formulario: un doble clic o un reintento devuelven el mismo borrador. */}
        <FormularioTraspaso opciones={opciones} accion={crearTraspaso} llaveIdempotencia={randomUUID()} textoGuardar="Guardar borrador" cancelarHref="/traspasos" />
      </Card>
    </>
  );
}
