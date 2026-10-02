import { AccionesBorrador } from "@/components/inventario/acciones-borrador";
import { EncabezadoMovimiento, Historial, PartidasMovimiento, pasosDeMovimiento, ValuacionDeMovimiento } from "@/components/inventario/detalle-movimiento";
import { RevertirMovimiento } from "@/components/inventario/revertir";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader, EncabezadoPagina } from "@/components/ui/superficies";
import type { ResultadoAccion } from "@/lib/inventario/acciones";
import type { datosDeDetalle } from "@/lib/inventario/pantallas";

type Datos = NonNullable<Awaited<ReturnType<typeof datosDeDetalle>>>;

/**
 * El detalle común de traspasos, devoluciones y ajustes. Cada botón aparece
 * solo si quien mira puede usarlo; la acción lo vuelve a exigir en el servidor.
 */
export function PaginaMovimiento({
  datos,
  nombre,
  lista,
  descripcion,
  borrador,
  revertir,
  edicion,
}: {
  datos: Datos;
  nombre: string;
  lista: { href: string; texto: string };
  descripcion: string;
  borrador?: { confirmar: (id: string) => Promise<ResultadoAccion>; descartar: (id: string, motivo: string) => Promise<ResultadoAccion>; aviso: string; texto: string };
  revertir: (id: string, motivo: string) => Promise<ResultadoAccion>;
  /** El formulario de edición, ya armado por la página: solo llega si puede editar. */
  edicion?: React.ReactNode;
}) {
  const { movimiento: m, puede, reversa, valuacion, existencias, saldo } = datos;
  const pendientes = saldo ? Object.fromEntries(saldo.map((s) => [s.articuloId, s.pendiente])) : null;

  return (
    <>
      <EncabezadoPagina
        titulo={m.folio ? `${nombre} ${m.folio}` : `${nombre} en borrador`}
        descripcion={descripcion}
        acciones={<ButtonLink href={lista.href} variante="secundario">{lista.texto}</ButtonLink>}
      />
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader titulo={nombre} />
          <EncabezadoMovimiento m={m} />
          {borrador && <AccionesBorrador key={m.id} id={m.id} puede={puede} confirmar={borrador.confirmar} descartar={borrador.descartar} aviso={borrador.aviso} textoConfirmar={borrador.texto} />}
          {puede.revertir && m.folio && <RevertirMovimiento id={m.id} folio={m.folio} revertir={revertir} />}
        </Card>

        {edicion ?? (
          <Card>
            <CardHeader
              titulo="Partidas"
              descripcion={
                m.estatus === "CONFIRMADO"
                  ? "Cada partida muestra de qué capa salió, a cuál entró o a cuál volvió cada pieza, con su costo."
                  : existencias
                    ? "«En origen» es lo que hay ahora; la confirmación lo vuelve a comprobar."
                    : undefined
              }
            />
            <PartidasMovimiento m={m} existencias={existencias} pendientes={pendientes} />
            {valuacion && <ValuacionDeMovimiento v={valuacion} />}
          </Card>
        )}

        <Card>
          <CardHeader titulo="Historial" />
          <Historial pasos={pasosDeMovimiento(m, reversa)} />
        </Card>
      </div>
    </>
  );
}
