"use client";

import { startTransition, useActionState, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Campo, Input, Select, Textarea } from "@/components/ui/campos";
import { PaginacionLocal, usePaginaLocal } from "@/components/ui/paginacion-local";
import {
  ESTADO_INICIAL,
  PARTIDA_VACIA,
  type EstadoEntrada,
  type ValoresEncabezado,
  type ValoresEntrada,
  type ValoresPartida,
} from "@/lib/entradas/formulario";
import type { OpcionesCaptura } from "@/lib/entradas/repo";
import { paginasConError } from "@/lib/paginacion";
import { cn } from "@/lib/utils";

const TASAS = [
  { valor: "0.16", etiqueta: "16 %" },
  { valor: "0.08", etiqueta: "8 %" },
  { valor: "0", etiqueta: "0 %" },
];

type Fila = { clave: number; valores: ValoresPartida };

export function FormularioEntrada({
  opciones,
  valores,
  llaveIdempotencia,
  accion,
  textoGuardar,
  cancelarHref,
}: {
  opciones: OpcionesCaptura;
  valores: ValoresEntrada;
  /** Solo en el alta: se genera al abrir el formulario y viaja oculta. */
  llaveIdempotencia?: string;
  accion: (estado: EstadoEntrada, formData: FormData) => Promise<EstadoEntrada>;
  textoGuardar: string;
  cancelarHref: string;
}) {
  const [estado, enviar, enviando] = useActionState(accion, ESTADO_INICIAL);
  const [encabezado, setEncabezado] = useState(valores.encabezado);
  // Las filas se identifican por un contador propio para que React no recicle
  // una fila en otra al quitar una intermedia; el name usa la posición, que es
  // como el servidor las numera al devolver errores.
  const [filas, setFilas] = useState<Fila[]>(() => valores.partidas.map((p, i) => ({ clave: i, valores: p })));
  const [siguiente, setSiguiente] = useState(valores.partidas.length);
  const { contenedor, pagina, irA, visible, alFinal } = usePaginaLocal(filas.length);

  const cambiarEncabezado = <K extends keyof ValoresEncabezado>(campo: K, valor: ValoresEncabezado[K]) =>
    setEncabezado((e) => ({ ...e, [campo]: valor }));
  const cambiarFila = (clave: number, cambio: Partial<ValoresPartida>) =>
    setFilas((f) => f.map((x) => (x.clave === clave ? { ...x, valores: { ...x.valores, ...cambio } } : x)));
  const agregar = () => {
    setFilas((f) => [...f, { clave: siguiente, valores: { ...PARTIDA_VACIA } }]);
    setSiguiente((n) => n + 1);
    alFinal(filas.length + 1);
  };
  const quitar = (clave: number) => setFilas((f) => (f.length > 1 ? f.filter((x) => x.clave !== clave) : f));

  const error = (ruta: string) => estado.errores[ruta];
  const usd = encabezado.moneda === "USD";

  return (
    <form
      // onSubmit y no action={enviar}: con action, React 19 reinicia el
      // formulario al terminar y los select controlados quedan en su primera
      // opción sin que el estado lo sepa.
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
        <Campo etiqueta="Proveedor" requerido error={error("encabezado.proveedorId")}>
          <Select name="encabezado.proveedorId" value={encabezado.proveedorId} onChange={(ev) => cambiarEncabezado("proveedorId", ev.target.value)} required>
            <option value="">Selecciona…</option>
            {opciones.proveedores.map((p) => (
              <option key={p.id} value={p.id}>{p.nombre}</option>
            ))}
          </Select>
        </Campo>

        <Campo etiqueta="Bodega destino" requerido error={error("encabezado.bodegaDestinoId")}>
          <Select name="encabezado.bodegaDestinoId" value={encabezado.bodegaDestinoId} onChange={(ev) => cambiarEncabezado("bodegaDestinoId", ev.target.value)} required>
            <option value="">Selecciona…</option>
            {opciones.bodegas.map((b) => (
              <option key={b.id} value={b.id}>{b.nombre}</option>
            ))}
          </Select>
        </Campo>

        <Campo etiqueta="Fecha de recepción" requerido ayuda="Hoy o anterior" error={error("encabezado.fecha")}>
          <Input type="date" name="encabezado.fecha" value={encabezado.fecha} onChange={(ev) => cambiarEncabezado("fecha", ev.target.value)} required />
        </Campo>

        <Campo etiqueta="Factura o remisión" ayuda="Varias recepciones pueden compartir la misma referencia" error={error("encabezado.referencia")}>
          <Input name="encabezado.referencia" value={encabezado.referencia} onChange={(ev) => cambiarEncabezado("referencia", ev.target.value)} maxLength={60} />
        </Campo>

        <Campo etiqueta="Moneda" requerido error={error("encabezado.moneda")}>
          <Select name="encabezado.moneda" value={encabezado.moneda} onChange={(ev) => cambiarEncabezado("moneda", ev.target.value === "USD" ? "USD" : "MXN")}>
            <option value="MXN">Pesos (MXN)</option>
            <option value="USD">Dólares (USD)</option>
          </Select>
        </Campo>

        <Campo
          etiqueta="Tipo de cambio"
          requerido={usd}
          ayuda={usd ? "Pesos por dólar, se congela al confirmar" : "Solo en dólares"}
          error={error("encabezado.tipoCambio")}
        >
          <Input
            name="encabezado.tipoCambio"
            inputMode="decimal"
            value={encabezado.tipoCambio}
            onChange={(ev) => cambiarEncabezado("tipoCambio", ev.target.value)}
            disabled={!usd}
            placeholder="17.50"
          />
        </Campo>

        <Campo etiqueta="Observaciones" error={error("encabezado.observaciones")}>
          <Textarea name="encabezado.observaciones" value={encabezado.observaciones} onChange={(ev) => cambiarEncabezado("observaciones", ev.target.value)} maxLength={500} className="min-h-10" />
        </Campo>
      </div>

      <div ref={contenedor} className="scroll-mt-4">
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
              oculta={!visible(i)}
              valores={p}
              articulos={opciones.articulos}
              moneda={encabezado.moneda}
              errores={estado.errores}
              onCambio={(cambio) => cambiarFila(clave, cambio)}
              onQuitar={filas.length > 1 ? () => quitar(clave) : undefined}
            />
          ))}
        </div>
        <PaginacionLocal pagina={pagina} irA={irA} sustantivo="partidas" conErrores={paginasConError(estado.errores)} className="mt-3 px-0" />
      </div>

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

function FilaPartida({
  posicion,
  oculta,
  valores,
  articulos,
  moneda,
  errores,
  onCambio,
  onQuitar,
}: {
  posicion: number;
  /** En otra página: sigue en el formulario, sin verse. */
  oculta: boolean;
  valores: ValoresPartida;
  articulos: OpcionesCaptura["articulos"];
  moneda: "MXN" | "USD";
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
  const conError = Object.keys(errores).some((k) => k.startsWith(`partidas.${posicion}.`));

  return (
    <fieldset data-fila={posicion} hidden={oculta} className={cn("rounded-md border border-border p-4", conError && "border-danger/50")}>
      <div className="mb-3 flex items-center justify-between">
        <legend className="text-xs font-semibold tracking-wide text-muted uppercase">Partida {posicion + 1}</legend>
        {onQuitar && (
          <Button type="button" variante="sutil" tamano="sm" onClick={onQuitar}>
            Quitar
          </Button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
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
          ayuda="Entera, sin decimales"
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

        <Campo
          etiqueta={`Costo por ${presentacion === "CAJA" ? "caja" : (unidad ?? "unidad").toLowerCase()} (${moneda})`}
          requerido
          ayuda="Sin IVA"
          error={error("costoUnitarioCapturado")}
        >
          <Input
            name={n("costoUnitarioCapturado")}
            inputMode="decimal"
            value={valores.costoUnitarioCapturado}
            onChange={(ev) => onCambio({ costoUnitarioCapturado: ev.target.value })}
            placeholder="0.00"
            required
          />
        </Campo>

        <Campo etiqueta="IVA" requerido error={error("tasaIva")}>
          <Select name={n("tasaIva")} value={valores.tasaIva} onChange={(ev) => onCambio({ tasaIva: ev.target.value })}>
            {TASAS.map((t) => (
              <option key={t.valor} value={t.valor}>{t.etiqueta}</option>
            ))}
          </Select>
        </Campo>

        <Campo etiqueta="Número de serie" ayuda="Solo informativo" error={error("numeroSerie")}>
          <Input name={n("numeroSerie")} value={valores.numeroSerie} onChange={(ev) => onCambio({ numeroSerie: ev.target.value })} maxLength={80} />
        </Campo>

        <Campo etiqueta="Observaciones" error={error("observaciones")}>
          <Input name={n("observaciones")} value={valores.observaciones} onChange={(ev) => onCambio({ observaciones: ev.target.value })} maxLength={300} />
        </Campo>
      </div>
    </fieldset>
  );
}
