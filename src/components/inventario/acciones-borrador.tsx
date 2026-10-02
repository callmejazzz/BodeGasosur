"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/campos";
import type { ResultadoAccion } from "@/lib/inventario/acciones";

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
  /** Lo que se pregunta antes de afectar el inventario. */
  aviso: string;
  textoConfirmar: string;
}) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [descartando, setDescartando] = useState(false);
  const [motivo, setMotivo] = useState("");

  const ejecutar = (fn: () => Promise<ResultadoAccion>) =>
    iniciar(async () => {
      setMensaje(null);
      const r = await fn();
      if (r.ok) setDescartando(false);
      else setMensaje(r.mensaje);
      // También tras un error: si otro ya lo movió, la pantalla muestra dónde quedó.
      router.refresh();
    });
  const abrir = () => {
    setMotivo("");
    setMensaje(null);
    setDescartando(true);
  };
  const volver = () => {
    setMensaje(null);
    setDescartando(false);
  };

  if (!mensaje && !puede.editar && !puede.confirmar) return null;

  return (
    <div className="flex flex-col gap-3 border-t border-border px-5 py-4">
      {mensaje && (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {mensaje}
        </p>
      )}
      {descartando && puede.editar ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            ejecutar(() => descartar(id, motivo));
          }}
        >
          <label className="flex min-w-64 flex-1 flex-col gap-1.5 text-sm font-medium text-muted-strong">
            ¿Por qué se descarta?
            <Input value={motivo} onChange={(ev) => setMotivo(ev.target.value)} maxLength={300} autoFocus required />
          </label>
          <Button type="submit" variante="peligro" disabled={pendiente}>
            {pendiente ? "Descartando…" : "Descartar borrador"}
          </Button>
          <Button type="button" variante="secundario" onClick={volver} disabled={pendiente}>
            Volver
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {puede.editar ? (
            <Button type="button" variante="sutil" onClick={abrir} disabled={pendiente}>
              Descartar borrador
            </Button>
          ) : (
            <span />
          )}
          {puede.confirmar && (
            <Button
              type="button"
              disabled={pendiente}
              onClick={() => {
                if (window.confirm(aviso)) ejecutar(() => confirmar(id));
              }}
            >
              {pendiente ? "Confirmando…" : textoConfirmar}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
