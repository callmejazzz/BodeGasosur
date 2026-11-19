"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { DialogoConfirmacion } from "@/components/ui/dialogo";
import type { ResultadoAccion } from "@/lib/inventario/acciones";
import { llamarAlServidor, resultadoSinConexion } from "@/lib/conexion";

/*
  Confirmar y descartar un borrador. Solo viaja el id (y el motivo): el actor
  sale de la sesión en el servidor y cada acción vuelve a exigir su permiso.
  Un doble clic devuelve el mismo folio.
*/

export function AccionesBorrador({
  id,
  puede,
  confirmar,
  descartar,
  aviso,
  textoConfirmar,
}: {
  id: string;
  puede: { editar: boolean; confirmar: boolean };
  confirmar: (id: string) => Promise<ResultadoAccion>;
  descartar: (id: string, motivo: string) => Promise<ResultadoAccion>;
  /** Qué pasa al confirmar: el diálogo lo dice antes de afectar el inventario. */
  aviso: string;
  textoConfirmar: string;
}) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [dialogo, setDialogo] = useState<"confirmar" | "descartar" | null>(null);
  const [motivo, setMotivo] = useState("");

  const ejecutar = (fn: () => Promise<ResultadoAccion>) =>
    iniciar(async () => {
      setMensaje(null);
      const r = await llamarAlServidor(fn, resultadoSinConexion);
      if (r.ok) setDialogo(null);
      else setMensaje(r.mensaje);
      // También tras un error: si otro ya lo movió, la pantalla muestra dónde quedó.
      router.refresh();
    });
  const abrir = (d: "confirmar" | "descartar") => {
    setMotivo("");
    setMensaje(null);
    setDialogo(d);
  };
  const volver = () => {
    setMensaje(null);
    setDialogo(null);
  };
  // Si tras refrescar la acción ya no aplica, su diálogo se cierra y el aviso queda en la pantalla
  const vigente = dialogo && puede[dialogo === "confirmar" ? "confirmar" : "editar"] ? dialogo : null;

  if (!mensaje && !puede.editar && !puede.confirmar) return null;

  return (
    <div className="flex flex-col gap-3 border-t border-border px-5 py-4">
      {mensaje && !vigente && (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {mensaje}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {puede.editar ? (
          <Button type="button" variante="sutil" onClick={() => abrir("descartar")} disabled={pendiente}>
            Descartar borrador
          </Button>
        ) : (
          <span />
        )}
        {puede.confirmar && (
          <Button type="button" onClick={() => abrir("confirmar")} disabled={pendiente}>
            {textoConfirmar}
          </Button>
        )}
      </div>

      {vigente === "confirmar" && (
        <DialogoConfirmacion
          titulo={`¿${textoConfirmar}?`}
          descripcion={aviso}
          confirmar={textoConfirmar}
          enCurso="Confirmando…"
          pendiente={pendiente}
          mensaje={mensaje}
          alConfirmar={() => ejecutar(() => confirmar(id))}
          alCerrar={volver}
        />
      )}
      {vigente === "descartar" && (
        <DialogoConfirmacion
          titulo="¿Descartar este borrador?"
          descripcion="El borrador queda descartado sin mover inventario. No se puede deshacer."
          campo={{ etiqueta: "¿Por qué se descarta?", valor: motivo, alCambiar: setMotivo, max: 300 }}
          confirmar="Descartar borrador"
          enCurso="Descartando…"
          peligro
          pendiente={pendiente}
          mensaje={mensaje}
          alConfirmar={() => ejecutar(() => descartar(id, motivo))}
          alCerrar={volver}
        />
      )}
    </div>
  );
}
