"use client";

import { use, useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/superficies";
import { ESTADO_INICIAL, HORARIO_DE_ALERTA, type EstadoCuenta, type MiCuenta } from "@/lib/cuenta/formulario";
import { cn } from "@/lib/utils";

/* Contenido del apartado «Preferencias» del perfil de Clerk. Imita sus secciones. */

function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted">{etiqueta}</dt>
      <dd className="min-w-0 text-sm text-foreground">{children}</dd>
    </div>
  );
}

export function Preferencias({
  cuenta,
  accion,
}: {
  cuenta: Promise<MiCuenta | null>;
  accion: (estado: EstadoCuenta, formData: FormData) => Promise<EstadoCuenta>;
}) {
  const datos = use(cuenta);
  const [estado, enviar, enviando] = useActionState(accion, ESTADO_INICIAL);

  return (
    <div className="flex flex-col">
      <h1 className="border-b border-border pb-4 text-[1.0625rem] font-bold text-foreground">Preferencias</h1>

      <section className="grid gap-4 border-b border-border py-5 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] sm:gap-6">
        <div>
          <h2 className="text-sm font-medium text-foreground">Alerta diaria de stock mínimo</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">Se envía un correo por día de los artículos con stock debajo del mínimo</p>
        </div>

        {datos ? (
          <div className="flex min-w-0 flex-col gap-4">
            <dl className="flex flex-col gap-3">
              <Dato etiqueta="Estado">
                <Badge tono={datos.alertasCorreo ? "exito" : "neutro"}>{datos.alertasCorreo ? "Activada" : "Desactivada"}</Badge>
              </Dato>
              <Dato etiqueta="Llega a">
                <span className="break-all">{datos.correo}</span>
                <span className="mt-0.5 block text-xs text-muted">Puedes cambiarlo en el apartado Perfil</span>
              </Dato>
              <Dato etiqueta="Horario">
                {HORARIO_DE_ALERTA}
                {!datos.alertasCorreo && (
                  <span className="mt-0.5 block text-xs text-muted">Si la activas después del envío de hoy, empieza mañana</span>
                )}
              </Dato>
            </dl>

            <form action={enviar} className="flex flex-wrap items-center gap-3">
              <Button
                type="submit"
                name="alertasCorreo"
                value={datos.alertasCorreo ? "desactivar" : "activar"}
                variante={datos.alertasCorreo ? "secundario" : "primario"}
                disabled={enviando}
              >
                {enviando ? "Guardando…" : datos.alertasCorreo ? "Desactivar alerta" : "Activar alerta"}
              </Button>
              {estado.mensaje && (
                <p role="status" className={cn("text-sm", estado.tono === "error" ? "text-danger" : "text-success")}>
                  {estado.mensaje}
                </p>
              )}
            </form>
          </div>
        ) : (
          <p role="alert" className="text-sm text-danger">No se pudieron cargar tus preferencias. Recarga la página</p>
        )}
      </section>
    </div>
  );
}
