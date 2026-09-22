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
          <EstadoVacio titulo="No puedes capturar entradas" descripcion="Tu rol permite consultarlas, no registrarlas." />
        </Card>
      </>
    );
  }

  // La llave nace con el formulario y viaja oculta: un doble clic o un
  // reintento devuelven el mismo borrador (11 §8).
  const llaveIdempotencia = randomUUID();

  return (
    <>
      <EncabezadoPagina titulo="Nueva entrada" descripcion="Se guarda como borrador. Confirmar la recepción es un paso aparte." />
      <Card>
        <CardHeader titulo="Datos de la recepción" descripcion="Captura por unidad o por caja; el sistema convierte a la unidad base del artículo y calcula el dinero en pesos." />
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
