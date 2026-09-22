"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/campos";
import type { ResultadoAccion } from "@/app/(sistema)/entradas/actions";

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
  const [descartando, setDescartando] = useState(false);
  const [motivo, setMotivo] = useState("");

  const ejecutar = (fn: () => Promise<ResultadoAccion>) =>
    iniciar(async () => {
      const r = await fn();
      if (r.ok) {
        setMensaje(null);
        router.refresh();
      } else {
        setMensaje(r.mensaje);
      }
    });

  return (
    <div className="flex flex-col gap-3 px-5 py-4">
      {mensaje && (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {mensaje}
        </p>
      )}

      {descartando ? (
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
          <Button type="button" variante="secundario" onClick={() => setDescartando(false)} disabled={pendiente}>
            Volver
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button type="button" variante="sutil" onClick={() => setDescartando(true)} disabled={pendiente}>
            Descartar borrador
          </Button>
          {puedeConfirmar && (
            <Button
              type="button"
              disabled={pendiente}
              onClick={() => {
                if (window.confirm("¿Confirmas que el material ya está en la bodega? Se asignará folio y la existencia subirá. Después no se puede editar.")) {
                  ejecutar(() => confirmar(id));
                }
              }}
            >
              {pendiente ? "Confirmando…" : "Confirmar recepción"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
