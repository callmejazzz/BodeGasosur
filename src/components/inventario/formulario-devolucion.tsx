"use client";

import { startTransition, useActionState, useState } from "react";
import { EditorPartidas, PARTIDA_VACIA, type Fila, type ValoresPartida } from "@/components/inventario/editor-partidas";
import { Button, ButtonLink } from "@/components/ui/button";
import { Campo, Select, Textarea } from "@/components/ui/campos";
import { SelectorBuscable } from "@/components/ui/selector-buscable";
import { ESTADO_INICIAL, type EstadoFormulario } from "@/lib/inventario/formulario";
import type { OpcionesCaptura, PaginaDeSalidas, SalidaDelFormulario } from "@/lib/inventario/pantallas";
import type { SalidaDevolvible } from "@/lib/inventario/repo";

export type ValoresDevolucion = { estacionId: string; bodegaDestinoId: string; observaciones: string; partidas: ValoresPartida[] };

const vacias = (filas: Fila[]) => filas.every((f) => !f.valores.articuloId && !f.valores.cantidadCapturada.trim());

/**
 * Alta o edición de una devolución. La salida se elige de las que la estación
 * puede devolver, tecleando para buscarla; también llega ya consultada desde
 * un enlace o el borrador. Vinculada, regresa a la bodega de la que salió,
 * solo ofrece sus artículos y muestra lo que falta por volver; sin salida,
 * entra sin costo a la bodega que se elija y no cierra ningún préstamo.
 */
export function FormularioDevolucion({
  opciones,
  vinculada,
  buscar,
  accion,
  llaveIdempotencia,
  valores,
  textoGuardar,
  cancelarHref,
}: {
  opciones: OpcionesCaptura;
  /** La salida con la que abre: la del enlace o la del borrador, con su aviso si ya no admite devolución. */
  vinculada?: SalidaDelFormulario | null;
  /** Una página de salidas devolvibles de la estación, en el servidor, con la sesión y el permiso de captura. */
  buscar: (busqueda: { estacionId: string; texto: string; pagina: number }) => Promise<PaginaDeSalidas>;
  accion: (estado: EstadoFormulario, formData: FormData) => Promise<EstadoFormulario>;
  llaveIdempotencia?: string;
  valores?: ValoresDevolucion;
  textoGuardar: string;
  cancelarHref: string;
}) {
  const [estado, enviar, enviando] = useActionState(accion, ESTADO_INICIAL);
  const [estacionId, setEstacionId] = useState(valores?.estacionId ?? "");
  const [salida, setSalida] = useState<SalidaDevolvible | null>(vinculada?.salida ?? null);
  const [aviso, setAviso] = useState<string | null>(vinculada?.aviso ?? null);
  // Lo elegido sin salida se conserva si se vincula una y luego se suelta.
  const [bodegaElegida, setBodegaElegida] = useState(valores?.bodegaDestinoId ?? "");
  const iniciales = valores?.partidas.length ? valores.partidas : [PARTIDA_VACIA];
  const [filas, setFilas] = useState<Fila[]>(iniciales.map((v, clave) => ({ clave, valores: { ...v } })));
  const [siguiente, setSiguiente] = useState(iniciales.length);
  const error = (ruta: string) => estado.errores[ruta];

  // Lo ya capturado sigue visible aunque no esté en la salida: al guardar, el servidor dice por qué no procede.
  const articulos = salida ? opciones.articulos.filter((a) => a.id in salida.pendientes || filas.some((f) => f.valores.articuloId === a.id)) : opciones.articulos;

  const elegirSalida = (s: SalidaDevolvible | null) => {
    setSalida(s);
    setAviso(null);
    // Sin nada capturado todavía, se propone lo que falta por volver.
    if (s && vacias(filas)) {
      const propuestas = Object.entries(s.pendientes).map(([articuloId, pendiente], i) => ({
        clave: siguiente + i,
        valores: { ...PARTIDA_VACIA, articuloId, cantidadCapturada: String(pendiente) },
      }));
      setFilas(propuestas);
      setSiguiente(siguiente + propuestas.length);
    }
  };

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
              elegirSalida(null);
            }}
            required
          >
            <option value="">Selecciona…</option>
            {opciones.estaciones.map((s) => (
              <option key={s.id} value={s.id}>{s.nombre}</option>
            ))}
          </Select>
        </Campo>
        <div className="flex flex-col gap-1.5">
          <span id="etiqueta-salida" className="text-sm font-medium text-muted-strong">Salida</span>
          <input type="hidden" name="encabezado.salidaId" value={salida?.id ?? ""} />
          <SelectorBuscable
            // Otra estación es otra lista: se vuelve a buscar desde cero.
            key={estacionId}
            valor={salida}
            alElegir={elegirSalida}
            cargar={async (texto, pagina) => {
              const r = await buscar({ estacionId, texto, pagina });
              return { opciones: r.salidas, pagina: r.pagina, aviso: r.aviso };
            }}
            etiqueta={(s) => `${s.folio}${s.esPrestamo ? " · préstamo" : ""}`}
            detalle={(s) => s.bodega.nombre}
            vacio="Sin salida vinculada"
            placeholder="Teclea el folio, p. ej. S-000123"
            deshabilitado={!estacionId}
            etiquetadoPor="etiqueta-salida"
          />
          {error("encabezado.salidaId") ? (
            <span className="text-xs font-medium text-danger">{error("encabezado.salidaId")}</span>
          ) : (
            <span className="text-xs text-muted">
              {salida ? (salida.esPrestamo ? "Préstamo: la devolución reduce lo que falta por volver" : "La devolución hereda el costo de esa salida") : "Sin salida: entra sin costo y no cierra préstamos"}
            </span>
          )}
        </div>
        <Campo
          etiqueta="Bodega que recibe"
          requerido
          ayuda={salida ? `La bodega de la que salió ${salida.folio}` : undefined}
          error={error("encabezado.bodegaDestinoId")}
        >
          {salida ? (
            <>
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

      {aviso && (
        <p role="status" className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
          {aviso}
        </p>
      )}
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
