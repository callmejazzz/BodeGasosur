"use client";

import { Button } from "@/components/ui/button";
import { Campo, Input, Select } from "@/components/ui/campos";
import { PaginacionLocal, usePaginaLocal } from "@/components/ui/paginacion-local";
import type { OpcionArticulo } from "@/lib/inventario/repo";
import { paginasConError } from "@/lib/paginacion";
import { cantidad, cn } from "@/lib/utils";

export type ValoresPartida = { articuloId: string; presentacion: "UNIDAD" | "CAJA"; cantidadCapturada: string; observaciones: string };
export type Fila = { clave: number; valores: ValoresPartida };

export const PARTIDA_VACIA: ValoresPartida = { articuloId: "", presentacion: "UNIDAD", cantidadCapturada: "", observaciones: "" };

/**
 * Las partidas de un traspaso o una devolución. `limite` es lo que hay en
 * origen o lo que falta por volver: informativo, porque el servidor lo vuelve
 * a comprobar bajo candado al confirmar.
 */
export function EditorPartidas({
  filas,
  setFilas,
  siguiente,
  setSiguiente,
  articulos,
  limite,
  etiquetaLimite,
  errores,
}: {
  filas: Fila[];
  setFilas: (f: (anterior: Fila[]) => Fila[]) => void;
  siguiente: number;
  setSiguiente: (n: number) => void;
  articulos: OpcionArticulo[];
  limite: Record<string, number> | null;
  etiquetaLimite: string;
  errores: Record<string, string>;
}) {
  const { contenedor, pagina, irA, visible, alFinal } = usePaginaLocal(filas.length);
  const cambiar = (clave: number, cambio: Partial<ValoresPartida>) =>
    setFilas((f) => f.map((x) => (x.clave === clave ? { ...x, valores: { ...x.valores, ...cambio } } : x)));
  const agregar = () => {
    setFilas((f) => [...f, { clave: siguiente, valores: { ...PARTIDA_VACIA } }]);
    setSiguiente(siguiente + 1);
    alFinal(filas.length + 1);
  };
  const quitar = (clave: number) => setFilas((f) => (f.length > 1 ? f.filter((x) => x.clave !== clave) : f));

  return (
    <div ref={contenedor} className="scroll-mt-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Partidas</h3>
        <Button type="button" variante="secundario" tamano="sm" onClick={agregar}>
          Agregar partida
        </Button>
      </div>
      {errores.partidas && <p className="mb-2 text-xs font-medium text-danger">{errores.partidas}</p>}
      <div className="flex flex-col gap-3">
        {filas.map(({ clave, valores: p }, i) => {
          const n = (campo: string) => `partidas.${i}.${campo}`;
          const error = (campo: string) => errores[n(campo)];
          const articulo = articulos.find((a) => a.id === p.articuloId);
          const porCaja = articulo?.piezasPorCaja ?? null;
          const presentacion = p.presentacion === "CAJA" && porCaja ? "CAJA" : "UNIDAD";
          const unidad = articulo?.unidad;
          const capturada = /^\d{1,7}$/.test(p.cantidadCapturada.trim()) ? Number(p.cantidadCapturada) : null;
          const piezas = capturada === null ? null : capturada * (presentacion === "CAJA" ? porCaja! : 1);
          const tope = articulo && limite ? (limite[articulo.id] ?? 0) : null;
          const conError = Object.keys(errores).some((k) => k.startsWith(`partidas.${i}.`));
          return (
            <fieldset key={clave} data-fila={i} hidden={!visible(i)} className={cn("rounded-md border border-border p-4", conError && "border-danger/50")}>
              <div className="mb-3 flex items-center justify-between">
                <legend className="text-xs font-semibold tracking-wide text-muted uppercase">Partida {i + 1}</legend>
                {filas.length > 1 && (
                  <Button type="button" variante="sutil" tamano="sm" onClick={() => quitar(clave)}>
                    Quitar
                  </Button>
                )}
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Campo etiqueta="Artículo" requerido error={error("articuloId")}>
                  <Select
                    name={n("articuloId")}
                    value={p.articuloId}
                    onChange={(ev) => {
                      const nuevo = articulos.find((a) => a.id === ev.target.value);
                      cambiar(clave, { articuloId: ev.target.value, presentacion: nuevo?.piezasPorCaja ? p.presentacion : "UNIDAD" });
                    }}
                    required
                  >
                    <option value="">Selecciona…</option>
                    {articulos.map((a) => (
                      <option key={a.id} value={a.id}>{a.clave} · {a.descripcion}</option>
                    ))}
                  </Select>
                </Campo>
                <Campo etiqueta="Presentación" requerido ayuda={porCaja ? `Una caja trae ${porCaja} ${unidad ?? ""}` : undefined} error={error("presentacion")}>
                  <Select name={n("presentacion")} value={presentacion} onChange={(ev) => cambiar(clave, { presentacion: ev.target.value === "CAJA" ? "CAJA" : "UNIDAD" })}>
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
                  <Input name={n("cantidadCapturada")} inputMode="numeric" pattern="\d*" value={p.cantidadCapturada} onChange={(ev) => cambiar(clave, { cantidadCapturada: ev.target.value })} required />
                </Campo>
                <Campo etiqueta="Observaciones" error={error("observaciones")}>
                  <Input name={n("observaciones")} value={p.observaciones} onChange={(ev) => cambiar(clave, { observaciones: ev.target.value })} maxLength={300} />
                </Campo>
              </div>
              {tope !== null && (
                <p className={cn("mt-3 text-xs", piezas !== null && piezas > tope ? "font-medium text-warning" : "text-muted")}>
                  {etiquetaLimite}: {cantidad(tope)} {unidad}.
                  {piezas !== null && piezas > tope && " No alcanza: se puede guardar, pero no se podrá confirmar así."}
                </p>
              )}
            </fieldset>
          );
        })}
      </div>
      <PaginacionLocal pagina={pagina} irA={irA} sustantivo="partidas" conErrores={paginasConError(errores)} className="mt-3 px-0" />
    </div>
  );
}
