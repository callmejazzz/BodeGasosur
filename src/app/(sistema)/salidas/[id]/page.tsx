import { notFound } from "next/navigation";
import { autorizarSalida, cancelarSalida, confirmarRecepcion, rechazarSalida, retirarSalida } from "../actions";
import { revertirMovimiento } from "../../reversas/actions";
import { AvisoDeReversa, SaldoDeSalida } from "@/components/inventario/relaciones";
import { RevertirMovimiento } from "@/components/inventario/revertir";
import { AccionesSalida } from "@/components/salidas/acciones-salida";
import { AvisosDeRetiro, EncabezadoSalida, HistorialSalida, PartidasSalida, ValuacionSalida } from "@/components/salidas/detalle-salida";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader, EncabezadoPagina } from "@/components/ui/superficies";
import { consultar } from "@/lib/db";
import { relacionesDeSalida } from "@/lib/inventario/pantallas";
import { datosDeDetalle } from "@/lib/salidas/pantallas";

export const dynamic = "force-dynamic";

const DESCRIPCION: Record<string, string> = {
  SOLICITADA: "Espera autorización. Sin folio y sin efecto en existencias.",
  AUTORIZADA: "Autorizada: falta registrar el retiro. Todavía no descuenta existencia.",
  RECHAZADA: "Rechazada. No tuvo efecto en existencias.",
  RETIRADA: "El material salió de la bodega: la existencia ya se descontó. Falta confirmar que la estación lo recibió.",
  RECIBIDA: "La estación confirmó la recepción. La salida está cerrada.",
  CANCELADO: "Cancelada antes del retiro. No tuvo efecto en existencias.",
};

const ACCIONES = { autorizar: autorizarSalida, rechazar: rechazarSalida, cancelar: cancelarSalida, retirar: retirarSalida, recibir: confirmarRecepcion };

export default async function PaginaSalida({ params }: PageProps<"/salidas/[id]">) {
  // Sesión y permiso primero; el id se valida ya dentro de la puerta.
  const datos = await consultar("salidas:leer", async (db, usuario) => {
    const detalle = await datosDeDetalle(db, usuario, (await params).id);
    return detalle && { ...detalle, relaciones: await relacionesDeSalida(db, usuario, detalle.salida) };
  });
  if (!datos) notFound();
  const { salida, puede, existencias, valuacion, avisos, relaciones } = datos;

  return (
    <>
      <EncabezadoPagina
        titulo={salida.folio ? `Salida ${salida.folio}` : "Salida sin folio"}
        descripcion={DESCRIPCION[salida.estatus]}
        acciones={<ButtonLink href="/salidas" variante="secundario">Todas las salidas</ButtonLink>}
      />

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader titulo="Salida" />
          <EncabezadoSalida salida={salida} devolucion={relaciones?.devolucion} />
          <AccionesSalida key={salida.id} id={salida.id} puede={puede} acciones={ACCIONES} />
          {relaciones?.reversa && <AvisoDeReversa reversa={relaciones.reversa} />}
          {relaciones?.revertir && salida.folio && <RevertirMovimiento id={salida.id} folio={salida.folio} revertir={revertirMovimiento} />}
        </Card>

        {relaciones?.saldo && (
          <Card>
            <CardHeader
              titulo={salida.esPrestamo ? "Préstamo" : "Devoluciones"}
              descripcion="Lo que volvió en devoluciones vigentes ligadas a esta salida. Una devolución sin salida no cuenta aquí."
            />
            <SaldoDeSalida salidaId={salida.id} saldo={relaciones.saldo} devoluciones={relaciones.devoluciones} esPrestamo={salida.esPrestamo} puedeDevolver={relaciones.puedeDevolver} />
          </Card>
        )}

        {avisos.length > 0 && (
          <Card className="border-warning/40">
            <CardHeader titulo="No se podrá retirar así" descripcion="El catálogo cambió desde la solicitud." />
            <AvisosDeRetiro avisos={avisos} />
          </Card>
        )}

        <Card>
          <CardHeader
            titulo="Partidas"
            descripcion={
              valuacion
                ? "Cada partida muestra de qué capa salió y a qué costo, en orden PEPS."
                : existencias
                  ? "«En bodega» es la existencia de ahora en la bodega de origen; el retiro la vuelve a comprobar."
                  : undefined
            }
          />
          <PartidasSalida salida={salida} existencias={existencias} />
          {valuacion && <ValuacionSalida valuacion={valuacion} />}
        </Card>

        <Card>
          <CardHeader titulo="Historial" />
          <HistorialSalida salida={salida} />
        </Card>
      </div>
    </>
  );
}
