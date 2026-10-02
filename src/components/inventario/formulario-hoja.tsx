"use client";

import { startTransition, useActionState } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Campo, Input, Select, Textarea } from "@/components/ui/campos";
import { ESTADO_INICIAL, type EstadoFormulario } from "@/lib/inventario/formulario";
import type { Opcion } from "@/lib/inventario/repo";

/** Abrir una hoja: bodega y motivo. Los renglones y la existencia esperada los pone el servidor. */
export function FormularioHoja({ bodegas, llaveIdempotencia, accion }: { bodegas: Opcion[]; llaveIdempotencia: string; accion: (e: EstadoFormulario, f: FormData) => Promise<EstadoFormulario> }) {
  const [estado, enviar, enviando] = useActionState(accion, ESTADO_INICIAL);
  const error = (ruta: string) => estado.errores[ruta] ?? estado.errores[`datos.${ruta}`];
  return (
    <form
      onSubmit={(ev) => {
        ev.preventDefault();
        const formData = new FormData(ev.currentTarget);
        startTransition(() => enviar(formData));
      }}
      className="flex flex-col gap-6 px-5 py-5"
    >
      <input type="hidden" name="llaveIdempotencia" value={llaveIdempotencia} />
      {estado.mensaje && (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {estado.mensaje}
        </p>
      )}
      <div className="grid gap-5 sm:grid-cols-3">
        <Campo etiqueta="Bodega" requerido error={error("bodegaId")}>
          <Select name="bodegaId" defaultValue="" required>
            <option value="">Selecciona…</option>
            {bodegas.map((b) => (
              <option key={b.id} value={b.id}>{b.nombre}</option>
            ))}
          </Select>
        </Campo>
        <Campo etiqueta="Motivo" requerido ayuda="Pasa a los ajustes: conteo mensual, merma, daño…" error={error("motivo")}>
          <Input name="motivo" maxLength={300} required />
        </Campo>
        <Campo etiqueta="Observaciones" error={error("observaciones")}>
          <Textarea name="observaciones" maxLength={500} className="min-h-10" />
        </Campo>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
        <ButtonLink href="/conteos" variante="secundario" prefetch={false}>
          Cancelar
        </ButtonLink>
        <Button type="submit" disabled={enviando}>
          {enviando ? "Abriendo…" : "Abrir hoja"}
        </Button>
      </div>
    </form>
  );
}
