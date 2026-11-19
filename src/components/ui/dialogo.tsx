"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/campos";

export type CampoDialogo = { etiqueta: string; valor: string; alCambiar: (valor: string) => void; max: number };

/**
 * Confirmación de una acción irreversible. Se abre al montarse y se cierra al desmontarse.
 * El `<dialog>` nativo atrapa el foco y Escape lo cierra sin actuar; al cerrarse, el foco
 * vuelve a quien lo abrió. Va en un portal porque puede abrirse desde dentro de otro formulario.
 */
export function DialogoConfirmacion({
  titulo,
  descripcion,
  campo,
  confirmar,
  enCurso,
  peligro = false,
  pendiente,
  mensaje,
  alConfirmar,
  alCerrar,
}: {
  titulo: string;
  descripcion: ReactNode;
  campo?: CampoDialogo;
  /** El verbo explícito del botón, como «Confirmar entrada». */
  confirmar: string;
  enCurso: string;
  peligro?: boolean;
  pendiente: boolean;
  mensaje: string | null;
  alConfirmar: () => void;
  alCerrar: () => void;
}) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const idTitulo = useId();
  const idDescripcion = useId();

  useEffect(() => {
    const d = dialogo.current;
    if (!d) return;
    const origen = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!d.open) d.showModal();
    // Sin campo, showModal enfoca «Volver»: lo primero y lo que no actúa
    entrada.current?.focus();
    return () => {
      if (d.open) d.close();
      if (origen?.isConnected) origen.focus();
    };
  }, []);

  return createPortal(
    <dialog
      ref={dialogo}
      aria-labelledby={idTitulo}
      aria-describedby={idDescripcion}
      onCancel={(ev) => {
        ev.preventDefault();
        if (!pendiente) alCerrar();
      }}
      className="m-auto w-[calc(100vw-2rem)] max-w-lg rounded-lg border border-border bg-surface p-0 text-foreground shadow-xl backdrop:bg-black/40"
    >
      <form
        className="flex flex-col gap-4 p-5"
        onSubmit={(ev) => {
          ev.preventDefault();
          // El portal no corta la propagación de React: el formulario de la página no debe enterarse
          ev.stopPropagation();
          alConfirmar();
        }}
      >
        <h2 id={idTitulo} className="text-base font-semibold">{titulo}</h2>
        <p id={idDescripcion} className="text-sm text-muted-strong">{descripcion}</p>
        {campo && (
          <label className="flex flex-col gap-1.5 text-sm font-medium text-muted-strong">
            {campo.etiqueta}
            <Input ref={entrada} value={campo.valor} onChange={(ev) => campo.alCambiar(ev.target.value)} maxLength={campo.max} required />
          </label>
        )}
        {mensaje && (
          <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
            {mensaje}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variante="secundario" onClick={alCerrar} disabled={pendiente}>
            Volver
          </Button>
          <Button type="submit" variante={peligro ? "peligro" : "primario"} disabled={pendiente}>
            {pendiente ? enCurso : confirmar}
          </Button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}
