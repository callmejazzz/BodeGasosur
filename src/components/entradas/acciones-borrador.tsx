"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { DialogoConfirmacion } from "@/components/ui/dialogo";
import type { ResultadoAccion } from "@/app/(sistema)/entradas/actions";
import { llamarAlServidor, resultadoSinConexion } from "@/lib/conexion";

/*
  Confirmar recepción y descartar. Quien ejecuta sale de la sesión en el
  servidor: aquí solo viaja el id. Un doble clic manda dos confirmaciones y el
  servicio devuelve el mismo folio en las dos (11 §8).
*/

export function AccionesBorrador({
  id,
  puedeConfirmar,
  confirmar,
  descartar,
}: {
  id: string;
  puedeConfirmar: boolean;
  confirmar: (id: string) => Promise<ResultadoAccion>;
  descartar: (id: string, motivo: string) => Promise<ResultadoAccion>;
}) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [dialogo, setDialogo] = useState<"confirmar" | "descartar" | null>(null);
  const [motivo, setMotivo] = useState("");

  const ejecutar = (fn: () => Promise<ResultadoAccion>) =>
    iniciar(async () => {
      const r = await llamarAlServidor(fn, resultadoSinConexion);
      if (r.ok) {
        setMensaje(null);
        setDialogo(null);
        router.refresh();
      } else {
        setMensaje(r.mensaje);
      }
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
  const vigente = dialogo === "confirmar" && !puedeConfirmar ? null : dialogo;

  return (
    <div className="flex flex-col gap-3 px-5 py-4">
      {mensaje && !vigente && (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {mensaje}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variante="sutil" onClick={() => abrir("descartar")} disabled={pendiente}>
          Descartar borrador
        </Button>
        {puedeConfirmar && (
          <Button type="button" onClick={() => abrir("confirmar")} disabled={pendiente}>
            Confirmar recepción
          </Button>
        )}
      </div>

      {vigente === "confirmar" && (
        <DialogoConfirmacion
          titulo="¿Confirmar la recepción?"
          descripcion="Confirma que el material ya está en la bodega: se asigna folio y la existencia sube. Después no se puede editar."
          confirmar="Confirmar recepción"
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
