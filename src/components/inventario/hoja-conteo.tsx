"use client";

import { useRouter } from "next/navigation";
import { startTransition, useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/campos";
import { Badge } from "@/components/ui/superficies";
import { Tabla, Td, Th, Tr } from "@/components/ui/tabla";
import type { ResultadoAccion } from "@/lib/inventario/acciones";
import { ESTADO_INICIAL, type EstadoFormulario } from "@/lib/inventario/formulario";
import type { OpcionArticulo } from "@/lib/inventario/repo";
import { cantidad, cn } from "@/lib/utils";

export type RenglonHoja = { articuloId: string; clave: string; descripcion: string; unidad: string; esperada: number | null; contada: string; observaciones: string };

/*
  La hoja de conteo. La existencia esperada la leyó el servidor; aquí solo se
  captura lo contado. Confirmar envía la revisión que la persona tiene en
  pantalla: si la hoja cambió o el stock se movió, el servidor lo rechaza.
*/
export function HojaConteo({
  id,
  revision,
  renglones: iniciales,
  editable,
  puedeConfirmar,
  articulos,
  guardar,
  actualizar,
  confirmar,
  descartar,
}: {
  id: string;
  revision: number;
  renglones: RenglonHoja[];
  editable: boolean;
  puedeConfirmar: boolean;
  articulos: OpcionArticulo[] | null;
  guardar: (estado: EstadoFormulario, formData: FormData) => Promise<EstadoFormulario>;
  actualizar: (id: string, revision: number) => Promise<ResultadoAccion>;
  confirmar: (id: string, revision: number) => Promise<ResultadoAccion>;
  descartar: (id: string, motivo: string) => Promise<ResultadoAccion>;
}) {
  const router = useRouter();
  const [estado, enviar, guardando] = useActionState(guardar, ESTADO_INICIAL);
  const [pendiente, iniciar] = useTransition();
  const [renglones, setRenglones] = useState(iniciales);
  const [sucio, setSucio] = useState(false);
  const [nuevo, setNuevo] = useState("");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [descartando, setDescartando] = useState(false);
  const [motivo, setMotivo] = useState("");

  const cambiar = (i: number, cambio: Partial<RenglonHoja>) => {
    setRenglones((r) => r.map((x, j) => (j === i ? { ...x, ...cambio } : x)));
    setSucio(true);
  };
  const ejecutar = (fn: () => Promise<ResultadoAccion>) =>
    iniciar(async () => {
      setMensaje(null);
      const r = await fn();
      if (!r.ok) setMensaje(r.mensaje);
      router.refresh();
    });
  const abrirDescarte = () => {
    setMotivo("");
    setMensaje(null);
    setDescartando(true);
  };
  const volver = () => {
    setMensaje(null);
    setDescartando(false);
  };
  const disponibles = (articulos ?? []).filter((a) => !renglones.some((r) => r.articuloId === a.id));
  const aviso = mensaje ?? estado.mensaje;

  return (
    <form
      onSubmit={(ev) => {
        ev.preventDefault();
        const formData = new FormData(ev.currentTarget);
        startTransition(() => {
          enviar(formData);
          setSucio(false);
        });
      }}
    >
      <input type="hidden" name="revision" value={revision} />
      {aviso && (
        <p role="alert" className="mx-5 mt-4 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {aviso}
        </p>
      )}
      <Tabla>
        <thead>
          <tr>
            <Th>Artículo</Th>
            <Th className="text-right">Esperada</Th>
            <Th className="text-right">Contada</Th>
            <Th className="text-right">Diferencia</Th>
            <Th>Observaciones</Th>
          </tr>
        </thead>
        <tbody>
          {renglones.map((r, i) => {
            const contada = /^\d{1,9}$/.test(r.contada.trim()) ? Number(r.contada) : null;
            const diferencia = contada !== null && r.esperada !== null ? contada - r.esperada : null;
            const error = estado.errores[`partidas.${i}.cantidadContada`];
            return (
              <Tr key={r.articuloId}>
                <Td className="whitespace-nowrap">
                  <input type="hidden" name={`partidas.${i}.articuloId`} value={r.articuloId} />
                  <span className="font-medium">{r.clave}</span> <span className="text-muted">{r.descripcion}</span>
                </Td>
                <Td className="text-right tabular whitespace-nowrap">
                  {r.esperada === null ? <span className="text-muted">al guardar</span> : `${cantidad(r.esperada)} ${r.unidad}`}
                </Td>
                <Td className="text-right">
                  {editable ? (
                    <Input
                      name={`partidas.${i}.cantidadContada`}
                      inputMode="numeric"
                      pattern="\d*"
                      value={r.contada}
                      onChange={(ev) => cambiar(i, { contada: ev.target.value })}
                      className={cn("ml-auto h-8 w-28 text-right", error && "border-danger")}
                      aria-label={`Contado de ${r.clave}`}
                      placeholder="—"
                    />
                  ) : (
                    <span className="tabular">{r.contada === "" ? "—" : `${cantidad(Number(r.contada))} ${r.unidad}`}</span>
                  )}
                  {error && <span className="block text-xs text-danger">{error}</span>}
                </Td>
                <Td className="text-right tabular whitespace-nowrap">
                  {diferencia === null ? <span className="text-muted">—</span> : diferencia === 0 ? <Badge>Sin diferencia</Badge> : (
                    <Badge tono={diferencia > 0 ? "info" : "peligro"}>{diferencia > 0 ? "+" : ""}{cantidad(diferencia)}</Badge>
                  )}
                </Td>
                <Td>
                  {editable ? (
                    <Input name={`partidas.${i}.observaciones`} value={r.observaciones} onChange={(ev) => cambiar(i, { observaciones: ev.target.value })} maxLength={300} className="h-8" aria-label={`Observaciones de ${r.clave}`} />
                  ) : (
                    <span className="text-muted">{r.observaciones || "—"}</span>
                  )}
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </Tabla>

      {editable && (
        <div className="flex flex-col gap-4 border-t border-border px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={nuevo} onChange={(ev) => setNuevo(ev.target.value)} className="h-8 w-80" aria-label="Artículo encontrado en la bodega">
              <option value="">Agregar un artículo que no está en la hoja…</option>
              {disponibles.map((a) => (
                <option key={a.id} value={a.id}>{a.clave} · {a.descripcion}</option>
              ))}
            </Select>
            <Button
              type="button"
              variante="secundario"
              tamano="sm"
              disabled={!nuevo}
              onClick={() => {
                const a = disponibles.find((x) => x.id === nuevo);
                if (!a) return;
                setRenglones((r) => [...r, { articuloId: a.id, clave: a.clave, descripcion: a.descripcion, unidad: a.unidad, esperada: null, contada: "", observaciones: "" }]);
                setNuevo("");
                setSucio(true);
              }}
            >
              Agregar
            </Button>
            <span className="text-xs text-muted">Déjalo vacío si no se contó: solo lo contado genera ajuste.</span>
          </div>

          {descartando ? (
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex min-w-64 flex-1 flex-col gap-1.5 text-sm font-medium text-muted-strong">
                ¿Por qué se descarta la hoja?
                <Input value={motivo} onChange={(ev) => setMotivo(ev.target.value)} maxLength={300} autoFocus />
              </label>
              <Button type="button" variante="peligro" disabled={pendiente || !motivo.trim()} onClick={() => ejecutar(() => descartar(id, motivo))}>
                Descartar hoja
              </Button>
              <Button type="button" variante="secundario" onClick={volver}>Volver</Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex gap-2">
                <Button type="button" variante="sutil" onClick={abrirDescarte} disabled={pendiente || guardando}>Descartar</Button>
                <Button type="button" variante="secundario" onClick={() => ejecutar(() => actualizar(id, revision))} disabled={pendiente || guardando || sucio}>
                  Actualizar existencias
                </Button>
              </span>
              <span className="flex items-center gap-2">
                {sucio && <span className="text-xs text-warning">Hay cambios sin guardar.</span>}
                <Button type="submit" variante={puedeConfirmar ? "secundario" : "primario"} disabled={guardando || pendiente}>
                  {guardando ? "Guardando…" : "Guardar conteo"}
                </Button>
                {puedeConfirmar && (
                  <Button
                    type="button"
                    disabled={pendiente || guardando || sucio}
                    onClick={() => {
                      if (window.confirm("¿Confirmas el conteo? Las diferencias se vuelven ajustes con folio y la existencia queda en lo contado. Después no se edita.")) {
                        ejecutar(() => confirmar(id, revision));
                      }
                    }}
                  >
                    {pendiente ? "Confirmando…" : "Confirmar conteo"}
                  </Button>
                )}
              </span>
            </div>
          )}
        </div>
      )}
    </form>
  );
}
