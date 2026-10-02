"use client";

import { startTransition, useActionState, useState } from "react";
import { EditorPartidas, PARTIDA_VACIA, type Fila, type ValoresPartida } from "@/components/inventario/editor-partidas";
import { Button, ButtonLink } from "@/components/ui/button";
import { Campo, Select, Textarea } from "@/components/ui/campos";
import { ESTADO_INICIAL, type EstadoFormulario } from "@/lib/inventario/formulario";
import type { OpcionesCaptura } from "@/lib/inventario/pantallas";

export type ValoresDevolucion = { estacionId: string; bodegaDestinoId: string; salidaId: string; observaciones: string; partidas: ValoresPartida[] };

/**
 * Alta o edición de una devolución. Vinculada a una salida, regresa a la
 * bodega de la que salió, solo ofrece sus artículos y muestra lo que falta por
 * volver; sin salida, entra sin costo a la bodega que se elija y no cierra
 * ningún préstamo.
 */
export function FormularioDevolucion({
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
  valores?: ValoresDevolucion;
  textoGuardar: string;
  cancelarHref: string;
}) {
  const [estado, enviar, enviando] = useActionState(accion, ESTADO_INICIAL);
  const [estacionId, setEstacionId] = useState(valores?.estacionId ?? "");
  const [salidaId, setSalidaId] = useState(valores?.salidaId ?? "");
  // Lo elegido sin salida se conserva si se vincula una y luego se suelta.
  const [bodegaElegida, setBodegaElegida] = useState(valores?.bodegaDestinoId ?? "");
  const iniciales = valores?.partidas.length ? valores.partidas : [PARTIDA_VACIA];
  const [filas, setFilas] = useState<Fila[]>(iniciales.map((v, clave) => ({ clave, valores: { ...v } })));
  const [siguiente, setSiguiente] = useState(iniciales.length);
  const error = (ruta: string) => estado.errores[ruta];

  const salidas = opciones.salidas.filter((s) => s.estacionId === estacionId);
  const salida = salidas.find((s) => s.id === salidaId) ?? null;
  // Lo ya capturado sigue visible aunque su saldo se haya agotado: el aviso de «no alcanza» lo explica.
  const articulos = salida ? opciones.articulos.filter((a) => a.id in salida.pendientes || iniciales.some((p) => p.articuloId === a.id)) : opciones.articulos;

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

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Campo etiqueta="Estación que devuelve" requerido error={error("encabezado.estacionId")}>
          <Select
            name="encabezado.estacionId"
            value={estacionId}
            onChange={(ev) => {
              setEstacionId(ev.target.value);
              setSalidaId("");
            }}
            required
          >
            <option value="">Selecciona…</option>
            {opciones.estaciones.map((s) => (
              <option key={s.id} value={s.id}>{s.nombre}</option>
            ))}
          </Select>
        </Campo>
        <Campo
          etiqueta="Salida"
          ayuda={salida ? (salida.esPrestamo ? "Préstamo: la devolución reduce lo que falta por volver" : "La devolución hereda el costo de esa salida") : "Sin salida: entra sin costo y no cierra préstamos"}
          error={error("encabezado.salidaId")}
        >
          <Select name="encabezado.salidaId" value={salidaId} onChange={(ev) => setSalidaId(ev.target.value)} disabled={!estacionId}>
            <option value="">Sin salida vinculada</option>
            {salidas.map((s) => (
              <option key={s.id} value={s.id}>{s.folio}{s.esPrestamo ? " · préstamo" : ""}</option>
            ))}
          </Select>
        </Campo>
        <Campo
          etiqueta="Bodega que recibe"
          requerido
          ayuda={salida ? `La bodega de la que salió ${salida.folio}` : undefined}
          error={error("encabezado.bodegaDestinoId")}
        >
          {salida ? (
            <>
              {/* Un select deshabilitado no se envía: la bodega viaja aparte y el servidor la vuelve a exigir. */}
              <input type="hidden" name="encabezado.bodegaDestinoId" value={salida.bodega.id} />
              <Select value={salida.bodega.id} disabled>
                <option value={salida.bodega.id}>{salida.bodega.nombre}</option>
              </Select>
            </>
          ) : (
            <Select name="encabezado.bodegaDestinoId" value={bodegaElegida} onChange={(ev) => setBodegaElegida(ev.target.value)} required>
              <option value="">Selecciona…</option>
              {opciones.bodegas.map((b) => (
                <option key={b.id} value={b.id}>{b.nombre}</option>
              ))}
            </Select>
          )}
        </Campo>
        <Campo etiqueta="Observaciones" error={error("encabezado.observaciones")}>
          <Textarea name="encabezado.observaciones" defaultValue={valores?.observaciones ?? ""} maxLength={500} className="min-h-10" />
        </Campo>
      </div>

      {!salida && (
        <p className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
          Sin salida vinculada, el material entra como procedencia no comprobada: sin costo y con la fecha de hoy.
        </p>
      )}

      <EditorPartidas
        filas={filas}
        setFilas={setFilas}
        siguiente={siguiente}
        setSiguiente={setSiguiente}
        articulos={articulos}
        limite={salida?.pendientes ?? null}
        etiquetaLimite={`Falta por volver de ${salida?.folio ?? ""}`}
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
