"use client";

import { startTransition, useActionState, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/campos";
import { ESTADO_INICIAL, type EstadoSalida } from "@/lib/salidas/formulario";
import type { OpcionesCaptura } from "@/lib/salidas/repo";
import { cantidad, cn } from "@/lib/utils";

type ValoresPartida = { articuloId: string; presentacion: "UNIDAD" | "CAJA"; cantidadCapturada: string; observaciones: string };
type Fila = { clave: number; valores: ValoresPartida };

const PARTIDA_VACIA: ValoresPartida = { articuloId: "", presentacion: "UNIDAD", cantidadCapturada: "", observaciones: "" };

/** Solo alta: una solicitud no se edita; para corregirla se cancela y se pide otra. */
export function FormularioSalida({
  opciones,
  llaveIdempotencia,
  accion,
}: {
  opciones: OpcionesCaptura;
  /** Se genera al abrir el formulario y viaja oculta: un reintento devuelve la misma solicitud. */
  llaveIdempotencia: string;
  accion: (estado: EstadoSalida, formData: FormData) => Promise<EstadoSalida>;
}) {
  const [estado, enviar, enviando] = useActionState(accion, ESTADO_INICIAL);
  const [bodegaId, setBodegaId] = useState("");
  // Contador propio para que React no recicle una fila en otra al quitar una
  // intermedia; el name usa la posición, que es como el servidor numera los errores.
  const [filas, setFilas] = useState<Fila[]>([{ clave: 0, valores: { ...PARTIDA_VACIA } }]);
  const [siguiente, setSiguiente] = useState(1);

  const cambiarFila = (clave: number, cambio: Partial<ValoresPartida>) =>
    setFilas((f) => f.map((x) => (x.clave === clave ? { ...x, valores: { ...x.valores, ...cambio } } : x)));
  const agregar = () => {
    setFilas((f) => [...f, { clave: siguiente, valores: { ...PARTIDA_VACIA } }]);
    setSiguiente((n) => n + 1);
  };
  const quitar = (clave: number) => setFilas((f) => (f.length > 1 ? f.filter((x) => x.clave !== clave) : f));

  const error = (ruta: string) => estado.errores[ruta];
  const bodega = opciones.bodegas.find((b) => b.id === bodegaId);

  return (
    <form
      // onSubmit y no action={enviar}: con action, React 19 reinicia el
      // formulario al terminar y los select controlados pierden su valor.
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

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <Campo etiqueta="Bodega origen" requerido error={error("encabezado.bodegaOrigenId")}>
          <Select name="encabezado.bodegaOrigenId" value={bodegaId} onChange={(ev) => setBodegaId(ev.target.value)} required>
            <option value="">Selecciona…</option>
            {opciones.bodegas.map((b) => (
              <option key={b.id} value={b.id}>{b.nombre}</option>
            ))}
          </Select>
        </Campo>

        <Campo etiqueta="Estación destino" requerido error={error("encabezado.estacionId")}>
          <Select name="encabezado.estacionId" defaultValue="" required>
            <option value="">Selecciona…</option>
            {opciones.estaciones.map((s) => (
              <option key={s.id} value={s.id}>{s.nombre}</option>
            ))}
          </Select>
        </Campo>

        <Campo etiqueta="Solicitante" ayuda="Quien pide el material; puede no tener cuenta" error={error("encabezado.solicitadoPorId")}>
          <Select name="encabezado.solicitadoPorId" defaultValue="">
            <option value="">Sin indicar</option>
            {opciones.personas.map((p) => (
              <option key={p.id} value={p.id}>{p.nombre}</option>
            ))}
          </Select>
        </Campo>

        <Campo etiqueta="Área" error={error("encabezado.areaId")}>
          <Select name="encabezado.areaId" defaultValue="">
            <option value="">Sin indicar</option>
            {opciones.areas.map((a) => (
              <option key={a.id} value={a.id}>{a.nombre}</option>
            ))}
          </Select>
        </Campo>

        <Campo etiqueta="Observaciones" error={error("encabezado.observaciones")}>
          <Textarea name="encabezado.observaciones" maxLength={500} className="min-h-10" />
        </Campo>

        <label className="flex items-center gap-2 self-center text-sm font-medium text-muted-strong">
          <Checkbox name="encabezado.esPrestamo" />
          Es préstamo
        </label>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Partidas</h3>
          <Button type="button" variante="secundario" tamano="sm" onClick={agregar}>
            Agregar partida
          </Button>
        </div>
        {error("partidas") && <p className="mb-2 text-xs font-medium text-danger">{error("partidas")}</p>}

        <div className="flex flex-col gap-3">
          {filas.map(({ clave, valores: p }, i) => (
            <FilaPartida
              key={clave}
              posicion={i}
              valores={p}
              articulos={opciones.articulos}
              bodega={bodega?.nombre ?? null}
              existencias={bodegaId ? (opciones.existencias[bodegaId] ?? {}) : null}
              errores={estado.errores}
              onCambio={(cambio) => cambiarFila(clave, cambio)}
              onQuitar={filas.length > 1 ? () => quitar(clave) : undefined}
            />
          ))}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
        <ButtonLink href="/salidas" variante="secundario" prefetch={false}>
          Cancelar
        </ButtonLink>
        <Button type="submit" disabled={enviando}>
          {enviando ? "Enviando…" : "Enviar solicitud"}
        </Button>
      </div>
    </form>
  );
}

function FilaPartida({
  posicion,
  valores,
  articulos,
  bodega,
  existencias,
  errores,
  onCambio,
  onQuitar,
}: {
  posicion: number;
  valores: ValoresPartida;
  articulos: OpcionesCaptura["articulos"];
  bodega: string | null;
  /** Lo que hay en la bodega elegida; null mientras no se elige. */
  existencias: Record<string, number> | null;
  errores: Record<string, string>;
  onCambio: (cambio: Partial<ValoresPartida>) => void;
  onQuitar?: () => void;
}) {
  const n = (campo: string) => `partidas.${posicion}.${campo}`;
  const error = (campo: string) => errores[n(campo)];
  const articulo = articulos.find((a) => a.id === valores.articuloId);
  const porCaja = articulo?.piezasPorCaja ?? null;
  // Lo que se muestra es lo que viaja: sin piezas por caja no hay opción Caja.
  const presentacion = valores.presentacion === "CAJA" && porCaja ? "CAJA" : "UNIDAD";
  const unidad = articulo?.unidad;
  const capturada = /^\d{1,7}$/.test(valores.cantidadCapturada.trim()) ? Number(valores.cantidadCapturada) : null;
  const piezas = capturada === null ? null : capturada * (presentacion === "CAJA" ? porCaja! : 1);
  const hay = articulo && existencias ? (existencias[articulo.id] ?? 0) : null;
  const conError = Object.keys(errores).some((k) => k.startsWith(`partidas.${posicion}.`));

  return (
    <fieldset className={cn("rounded-md border border-border p-4", conError && "border-danger/50")}>
      <div className="mb-3 flex items-center justify-between">
        <legend className="text-xs font-semibold tracking-wide text-muted uppercase">Partida {posicion + 1}</legend>
        {onQuitar && (
          <Button type="button" variante="sutil" tamano="sm" onClick={onQuitar}>
            Quitar
          </Button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Campo etiqueta="Artículo" requerido error={error("articuloId")}>
          <Select
            name={n("articuloId")}
            value={valores.articuloId}
            onChange={(ev) => {
              const nuevo = articulos.find((a) => a.id === ev.target.value);
              onCambio({ articuloId: ev.target.value, presentacion: nuevo?.piezasPorCaja ? valores.presentacion : "UNIDAD" });
            }}
            required
          >
            <option value="">Selecciona…</option>
            {articulos.map((a) => (
              <option key={a.id} value={a.id}>{a.clave} · {a.descripcion}</option>
            ))}
          </Select>
        </Campo>

        <Campo
          etiqueta="Presentación"
          requerido
          ayuda={porCaja ? `Una caja trae ${porCaja} ${unidad ?? ""}` : articulo ? "Este artículo no se maneja por caja" : undefined}
          error={error("presentacion")}
        >
          <Select name={n("presentacion")} value={presentacion} onChange={(ev) => onCambio({ presentacion: ev.target.value === "CAJA" ? "CAJA" : "UNIDAD" })}>
            <option value="UNIDAD">{unidad ?? "Unidad"}</option>
            {porCaja && <option value="CAJA">Caja</option>}
          </Select>
        </Campo>

        <Campo
          etiqueta={presentacion === "CAJA" ? "Cantidad de cajas" : unidad ? `Cantidad en ${unidad}` : "Cantidad"}
          requerido
          ayuda={presentacion === "CAJA" && piezas !== null ? `= ${cantidad(piezas)} ${unidad}` : "Entera, sin decimales"}
          error={error("cantidadCapturada")}
        >
          <Input
            name={n("cantidadCapturada")}
            inputMode="numeric"
            pattern="\d*"
            value={valores.cantidadCapturada}
            onChange={(ev) => onCambio({ cantidadCapturada: ev.target.value })}
            required
          />
        </Campo>

        <Campo etiqueta="Observaciones" error={error("observaciones")}>
          <Input name={n("observaciones")} value={valores.observaciones} onChange={(ev) => onCambio({ observaciones: ev.target.value })} maxLength={300} />
        </Campo>
      </div>

      {hay !== null && (
        <p className={cn("mt-3 text-xs", piezas !== null && piezas > hay ? "font-medium text-warning" : "text-muted")}>
          En {bodega}: {cantidad(hay)} {unidad}.
          {piezas !== null && piezas > hay && " No alcanza: la solicitud se puede enviar, pero no se podrá retirar hasta que haya existencia."}
        </p>
      )}
    </fieldset>
  );
}
