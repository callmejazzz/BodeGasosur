"use client";

import { use, useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/superficies";
import type { CausaDeExclusion } from "@/lib/correo/exclusion";
import type { EstadoDelAviso } from "@/lib/correo/entrega";
import { ESTADO_INICIAL, HORARIO_DE_ALERTA, type AvisoDelDia, type EstadoCuenta, type MiCuenta } from "@/lib/cuenta/formulario";
import { formatearFecha } from "@/lib/fechas";
import { cn } from "@/lib/utils";

/* Contenido del apartado «Preferencias» del perfil de Clerk */

type Tono = "neutro" | "exito" | "aviso" | "peligro" | "info";

const ESTADO_DEL_AVISO: Record<EstadoDelAviso, { texto: string; tono: Tono }> = {
  EN_PROCESO: { texto: "En proceso", tono: "neutro" },
  ACEPTADO: { texto: "Aceptado por Resend", tono: "info" },
  ENTREGA_DEMORADA: { texto: "Entrega demorada", tono: "aviso" },
  ENTREGADO: { texto: "Entregado", tono: "exito" },
  NO_ENTREGADO: { texto: "No entregado", tono: "peligro" },
  MARCADO_COMO_SPAM: { texto: "Marcado como spam", tono: "peligro" },
  NO_SE_ENVIO: { texto: "No se envió", tono: "peligro" },
  SIN_CONFIRMAR: { texto: "Sin confirmar", tono: "aviso" },
};

// Sin decir qué cuenta recibió el correo
const POR_QUE_EXCLUIDA: Record<CausaDeExclusion, string> = {
  QUEJA: "un correo de la alerta a esta dirección se marcó como spam",
  REBOTE: "un correo de la alerta a esta dirección rebotó de forma permanente",
  SUPRESION: "el servicio de envío puso esta dirección en su lista de bloqueo",
};

const AVISO_DEL_DIA: Record<AvisoDelDia, string> = {
  SIN_BAJO_MINIMO: "Hoy no hubo artículos bajo mínimo",
  EMPIEZA_MANIANA: "Empieza mañana: la alerta de hoy ya se preparó sin incluirte",
};

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
              <Dato etiqueta="Último aviso">
                {datos.ultimoAviso ? (
                  <span className="flex flex-wrap items-center gap-2">
                    {formatearFecha(datos.ultimoAviso.fecha)}
                    <Badge tono={ESTADO_DEL_AVISO[datos.ultimoAviso.estado].tono}>{ESTADO_DEL_AVISO[datos.ultimoAviso.estado].texto}</Badge>
                  </span>
                ) : (
                  <span className="text-muted">Todavía no has recibido ninguno</span>
                )}
              </Dato>
            </dl>

            {datos.exclusion && (
              <div role="note" className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-foreground">
                <p className="font-medium">Tu dirección actual no recibe la alerta</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-strong">
                  Se excluyó porque {POR_QUE_EXCLUIDA[datos.exclusion]}. Volverás a recibirla cuando uses otra dirección. Puedes cambiarla en el apartado Perfil
                </p>
              </div>
            )}
            {datos.avisoDelDia && (
              <p role="note" className="rounded-md bg-surface-muted px-3 py-2 text-sm text-muted-strong">
                {AVISO_DEL_DIA[datos.avisoDelDia]}
              </p>
            )}

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
