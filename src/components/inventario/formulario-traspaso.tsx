"use client";

import { startTransition, useActionState, useState } from "react";
import { EditorPartidas, PARTIDA_VACIA, type Fila, type ValoresPartida } from "@/components/inventario/editor-partidas";
import { Button, ButtonLink } from "@/components/ui/button";
import { Campo, Select, Textarea } from "@/components/ui/campos";
import { ESTADO_INICIAL, type EstadoFormulario } from "@/lib/inventario/formulario";
import type { OpcionesCaptura } from "@/lib/inventario/pantallas";

export type ValoresTraspaso = { bodegaOrigenId: string; bodegaDestinoId: string; observaciones: string; partidas: ValoresPartida[] };

/** Alta (con llave) o edición de un borrador de traspaso: la misma captura, otra acción. */
export function FormularioTraspaso({
  opciones,
  accion,
  llaveIdempotencia,
  valores,
  textoGuardar,
  cancelarHref,
}: {
  opciones: OpcionesCaptura;
  accion: (estado: EstadoFormulario, formData: FormData) => Promise<EstadoFormulario>;
  llaveIdempotencia?: string;
  valores?: ValoresTraspaso;
  textoGuardar: string;
  cancelarHref: string;
}) {
  const [estado, enviar, enviando] = useActionState(accion, ESTADO_INICIAL);
  const [origen, setOrigen] = useState(valores?.bodegaOrigenId ?? "");
  const [destino, setDestino] = useState(valores?.bodegaDestinoId ?? "");
  const iniciales = valores?.partidas.length ? valores.partidas : [PARTIDA_VACIA];
  const [filas, setFilas] = useState<Fila[]>(iniciales.map((v, clave) => ({ clave, valores: { ...v } })));
  const [siguiente, setSiguiente] = useState(iniciales.length);
  const error = (ruta: string) => estado.errores[ruta];

  return (
    <form
      onSubmit={(ev) => {
        ev.preventDefault();
        const formData = new FormData(ev.currentTarget);
        startTransition(() => enviar(formData));
      }}
      className="flex flex-col gap-6 px-5 py-5"
    >
      {llaveIdempotencia && <input type="hidden" name="llaveIdempotencia" value={llaveIdempotencia} />}
      {estado.mensaje && (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {estado.mensaje}
        </p>
      )}

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <Campo etiqueta="Bodega origen" requerido error={error("encabezado.bodegaOrigenId")}>
          <Select name="encabezado.bodegaOrigenId" value={origen} onChange={(ev) => setOrigen(ev.target.value)} required>
            <option value="">Selecciona…</option>
            {opciones.bodegas.map((b) => (
              <option key={b.id} value={b.id}>{b.nombre}</option>
            ))}
          </Select>
        </Campo>
        <Campo etiqueta="Bodega destino" requerido error={error("encabezado.bodegaDestinoId")}>
          <Select name="encabezado.bodegaDestinoId" value={destino} onChange={(ev) => setDestino(ev.target.value)} required>
            <option value="">Selecciona…</option>
            {opciones.bodegas.filter((b) => b.id !== origen).map((b) => (
              <option key={b.id} value={b.id}>{b.nombre}</option>
            ))}
          </Select>
        </Campo>
        <Campo etiqueta="Observaciones" error={error("encabezado.observaciones")}>
          <Textarea name="encabezado.observaciones" defaultValue={valores?.observaciones ?? ""} maxLength={500} className="min-h-10" />
        </Campo>
      </div>

      <EditorPartidas
        filas={filas}
        setFilas={setFilas}
        siguiente={siguiente}
        setSiguiente={setSiguiente}
        articulos={opciones.articulos}
        limite={origen ? (opciones.existencias[origen] ?? {}) : null}
        etiquetaLimite="En la bodega de origen"
        errores={estado.errores}
      />

      <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
        <ButtonLink href={cancelarHref} variante="secundario" prefetch={false}>
          Cancelar
        </ButtonLink>
        <Button type="submit" disabled={enviando}>
          {enviando ? "Guardando…" : textoGuardar}
        </Button>
      </div>
    </form>
  );
}
