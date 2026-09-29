"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ResultadoAccion } from "@/app/(sistema)/salidas/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/campos";
import type { Facultades } from "@/lib/salidas/pantallas";

/*
  Las transiciones de una salida. Solo viaja el id (y el motivo o quién se lo
  lleva): el actor sale de la sesión en el servidor, y cada acción vuelve a
  exigir su permiso. Un doble clic devuelve el mismo resultado.
*/

type Acciones = {
  autorizar: (id: string) => Promise<ResultadoAccion>;
  rechazar: (id: string, motivo: string) => Promise<ResultadoAccion>;
  cancelar: (id: string, motivo: string) => Promise<ResultadoAccion>;
  retirar: (id: string, entregadoA: string) => Promise<ResultadoAccion>;
  recibir: (id: string) => Promise<ResultadoAccion>;
};

type Captura = "rechazar" | "cancelar" | "retirar";

const CAPTURA: Record<Captura, { pregunta: string; boton: string; enCurso: string; max: number; peligro: boolean }> = {
  rechazar: { pregunta: "¿Por qué se rechaza?", boton: "Rechazar salida", enCurso: "Rechazando…", max: 300, peligro: true },
  cancelar: { pregunta: "¿Por qué se cancela?", boton: "Cancelar salida", enCurso: "Cancelando…", max: 300, peligro: true },
  retirar: { pregunta: "¿Quién se lleva el material?", boton: "Registrar retiro", enCurso: "Registrando…", max: 120, peligro: false },
};

export function AccionesSalida({ id, puede, acciones }: { id: string; puede: Facultades; acciones: Acciones }) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [captura, setCaptura] = useState<Captura | null>(null);
  const [texto, setTexto] = useState("");

  const ejecutar = (fn: () => Promise<ResultadoAccion>) =>
    iniciar(async () => {
      setMensaje(null);
      const r = await fn();
      if (r.ok) setCaptura(null);
      else setMensaje(r.mensaje);
      // También tras un error: si otro usuario ya la movió, la pantalla muestra dónde quedó.
      router.refresh();
    });

  // Si tras refrescar la acción ya no aplica, su captura se cierra sola.
  const vigente = captura && (captura === "rechazar" ? puede.autorizar : puede[captura]) ? captura : null;

  const abrir = (c: Captura) => {
    setTexto("");
    setMensaje(null);
    setCaptura(c);
  };
  const volver = () => {
    setMensaje(null);
    setCaptura(null);
  };

  // Montado aunque no quede acción: así el aviso sobrevive si otro la cerró.
  if (!mensaje && !puede.autorizar && !puede.cancelar && !puede.retirar && !puede.recibir) return null;

  return (
    <div className="flex flex-col gap-3 border-t border-border px-5 py-4">
      {mensaje && (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {mensaje}
        </p>
      )}

      {vigente ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            ejecutar(() => acciones[vigente](id, texto));
          }}
        >
          <label className="flex min-w-64 flex-1 flex-col gap-1.5 text-sm font-medium text-muted-strong">
            {CAPTURA[vigente].pregunta}
            <Input value={texto} onChange={(ev) => setTexto(ev.target.value)} maxLength={CAPTURA[vigente].max} autoFocus required />
            {vigente === "retirar" && (
              <span className="text-xs font-normal text-muted">Descuenta la existencia por PEPS y asigna folio. No se puede deshacer.</span>
            )}
          </label>
          <Button type="submit" variante={CAPTURA[vigente].peligro ? "peligro" : "primario"} disabled={pendiente}>
            {pendiente ? CAPTURA[vigente].enCurso : CAPTURA[vigente].boton}
          </Button>
          <Button type="button" variante="secundario" onClick={volver} disabled={pendiente}>
            Volver
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex flex-wrap gap-2">
            {puede.cancelar && (
              <Button type="button" variante="sutil" onClick={() => abrir("cancelar")} disabled={pendiente}>
                Cancelar salida
              </Button>
            )}
            {puede.autorizar && (
              <Button type="button" variante="sutil" onClick={() => abrir("rechazar")} disabled={pendiente}>
                Rechazar
              </Button>
            )}
          </span>
          <span className="flex flex-wrap gap-2">
            {puede.autorizar && (
              <Button
                type="button"
                disabled={pendiente}
                onClick={() => {
                  if (window.confirm("¿Autorizas esta salida tal como está? Autorizar no descuenta existencia; las partidas ya no podrán cambiar.")) {
                    ejecutar(() => acciones.autorizar(id));
                  }
                }}
              >
                {pendiente ? "Autorizando…" : "Autorizar"}
              </Button>
            )}
            {puede.retirar && (
              <Button type="button" onClick={() => abrir("retirar")} disabled={pendiente}>
                Registrar retiro
              </Button>
            )}
            {puede.recibir && (
              <Button
                type="button"
                disabled={pendiente}
                onClick={() => {
                  if (window.confirm("¿Confirmas que la estación recibió el material? La salida queda cerrada.")) {
                    ejecutar(() => acciones.recibir(id));
                  }
                }}
              >
                {pendiente ? "Confirmando…" : "Confirmar recepción"}
              </Button>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
