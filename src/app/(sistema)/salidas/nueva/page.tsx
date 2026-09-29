import { randomUUID } from "node:crypto";
import { crearSalida } from "../actions";
import { FormularioSalida } from "@/components/salidas/formulario-salida";
import { Card, CardHeader, EncabezadoPagina, EstadoVacio } from "@/components/ui/superficies";
import { consultar, SinPermiso } from "@/lib/db";
import { cargarOpcionesDeCaptura } from "@/lib/salidas/repo";

export const dynamic = "force-dynamic";

export default async function PaginaNuevaSalida() {
  let opciones;
  try {
    opciones = await consultar("salidas:capturar", (db) => cargarOpcionesDeCaptura(db));
  } catch (error) {
    if (!(error instanceof SinPermiso)) throw error;
    return (
      <>
        <EncabezadoPagina titulo="Nueva salida" />
        <Card className="max-w-3xl">
          <EstadoVacio titulo="No puedes capturar salidas" descripcion="Tu cuenta permite consultarlas, no solicitarlas." />
        </Card>
      </>
    );
  }

  // La llave nace con el formulario y viaja oculta: un doble clic o un
  // reintento devuelven la misma solicitud.
  const llaveIdempotencia = randomUUID();

  return (
    <>
      <EncabezadoPagina
        titulo="Nueva salida"
        descripcion="Se guarda como solicitud: no descuenta existencia hasta que alguien facultado la autorice y se registre el retiro."
      />
      <Card>
        <CardHeader
          titulo="Solicitud de material"
          descripcion="Captura por unidad o por caja; el sistema convierte a la unidad base. La existencia que se muestra es informativa: se vuelve a comprobar al retirar."
        />
        <FormularioSalida opciones={opciones} llaveIdempotencia={llaveIdempotencia} accion={crearSalida} />
      </Card>
    </>
  );
}
