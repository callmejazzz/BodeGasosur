import { randomUUID } from "node:crypto";
import { abrirHoja } from "../actions";
import { FormularioHoja } from "@/components/inventario/formulario-hoja";
import { Card, CardHeader, EncabezadoPagina, EstadoVacio } from "@/components/ui/superficies";
import { consultar, SinPermiso } from "@/lib/db";
import { opcionesDeBodegas } from "@/lib/inventario/repo";

export const dynamic = "force-dynamic";

export default async function PaginaNuevaHoja() {
  let bodegas;
  try {
    bodegas = await consultar("ajustes:capturar", (db) => opcionesDeBodegas(db));
  } catch (error) {
    if (!(error instanceof SinPermiso)) throw error;
    return (
      <>
        <EncabezadoPagina titulo="Nueva hoja de conteo" />
        <Card className="max-w-3xl">
          <EstadoVacio titulo="No puedes abrir hojas de conteo" descripcion="Tu cuenta permite consultarlas, no capturarlas." />
        </Card>
      </>
    );
  }
  return (
    <>
      <EncabezadoPagina titulo="Nueva hoja de conteo" descripcion="Se abre con la existencia actual de cada artículo de la bodega. No congela la bodega ni reserva nada." />
      <Card className="max-w-4xl">
        <CardHeader titulo="¿Qué bodega se cuenta?" />
        <FormularioHoja bodegas={bodegas} llaveIdempotencia={randomUUID()} accion={abrirHoja} />
      </Card>
    </>
  );
}
