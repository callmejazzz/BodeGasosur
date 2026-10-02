"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/campos";
import type { ResultadoAccion } from "@/lib/inventario/acciones";

/*
  La reversa de un movimiento cerrado. Solo se dibuja para el Superadmin y la
  acción vuelve a exigirlo. Crea otro asiento: al terminar se abre ese asiento.
*/

export function RevertirMovimiento({ id, folio, revertir }: { id: string; folio: string; revertir: (id: string, motivo: string) => Promise<ResultadoAccion> }) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [mensaje, setMensaje] = useState<string | null>(null);

  // El aviso pertenece a ese intento: al volver o abrir de nuevo se va.
  const abrir = () => {
    setMotivo("");
    setMensaje(null);
    setAbierto(true);
  };
  const volver = () => {
    setMensaje(null);
    setAbierto(false);
  };

  return (
    <div className="flex flex-col gap-3 border-t border-border px-5 py-4">
      {mensaje && (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {mensaje}
        </p>
      )}
      {abierto ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            iniciar(async () => {
              setMensaje(null);
              const r = await revertir(id, motivo);
              if (!r.ok) {
                setMensaje(r.mensaje);
                router.refresh();
              } else if (r.href) {
                router.push(r.href);
              }
            });
          }}
        >
          <label className="flex min-w-64 flex-1 flex-col gap-1.5 text-sm font-medium text-muted-strong">
            ¿Por qué se revierte {folio}?
            <Input value={motivo} onChange={(ev) => setMotivo(ev.target.value)} maxLength={300} autoFocus required />
            <span className="text-xs font-normal text-muted">
              Crea un asiento inverso con folio propio. {folio} no se borra ni se edita, y solo se revierte una vez.
            </span>
          </label>
          <Button type="submit" variante="peligro" disabled={pendiente}>
            {pendiente ? "Revirtiendo…" : "Registrar reversa"}
          </Button>
          <Button type="button" variante="secundario" onClick={volver} disabled={pendiente}>
            Volver
          </Button>
        </form>
      ) : (
        <div className="flex justify-end">
          <Button type="button" variante="secundario" onClick={abrir}>
            Revertir
          </Button>
        </div>
      )}
    </div>
  );
}
