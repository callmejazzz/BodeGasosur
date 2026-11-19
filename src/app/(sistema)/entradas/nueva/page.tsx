import { randomUUID } from "node:crypto";
import { crearEntrada } from "../actions";
import { FormularioEntrada } from "@/components/entradas/formulario-entrada";
import { Card, CardHeader, EncabezadoPagina, EstadoVacio } from "@/components/ui/superficies";
import { consultar, SinPermiso } from "@/lib/db";
import { valoresIniciales } from "@/lib/entradas/formulario";
import { cargarOpcionesDeCaptura } from "@/lib/entradas/repo";

export const dynamic = "force-dynamic";

export default async function PaginaNuevaEntrada() {
  let opciones;
  try {
    opciones = await consultar("entradas:capturar", (db) => cargarOpcionesDeCaptura(db));
  } catch (error) {
    if (!(error instanceof SinPermiso)) throw error;
    return (
      <>
        <EncabezadoPagina titulo="Nueva entrada" />
        <Card className="max-w-3xl">
          <EstadoVacio titulo="No puedes capturar entradas" descripcion="No cuentas con el permiso para capturar entradas" />
        </Card>
      </>
    );
  }

  // La llave nace con el formulario y viaja oculta
  const llaveIdempotencia = randomUUID();

  return (
    <>
      <EncabezadoPagina titulo="Nueva entrada" descripcion="Las nuevas entradas primero se guardan como un borrador" />
      <Card>
        <CardHeader titulo="Datos de la recepción" descripcion="Rellena correctamente cada campo solicitado" />
        <FormularioEntrada
          opciones={opciones}
          valores={valoresIniciales()}
          llaveIdempotencia={llaveIdempotencia}
          accion={crearEntrada}
          textoGuardar="Guardar borrador"
          cancelarHref="/entradas"
        />
      </Card>
    </>
  );
}
