"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ResultadoAccion } from "@/app/(sistema)/salidas/actions";
import { Button } from "@/components/ui/button";
import { DialogoConfirmacion } from "@/components/ui/dialogo";
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

type Clave = keyof Acciones;

const DIALOGO: Record<Clave, { titulo: string; descripcion: string; confirmar: string; enCurso: string; peligro?: boolean; campo?: { etiqueta: string; max: number } }> = {
  autorizar: {
    titulo: "¿Autorizar esta salida?",
    descripcion: "Autorizar no descuenta existencia, pero las partidas ya no podrán cambiar.",
    confirmar: "Autorizar salida",
    enCurso: "Autorizando…",
  },
  rechazar: {
    titulo: "¿Rechazar esta salida?",
    descripcion: "La salida queda rechazada sin mover inventario. No se puede deshacer.",
    confirmar: "Rechazar salida",
    enCurso: "Rechazando…",
    peligro: true,
    campo: { etiqueta: "¿Por qué se rechaza?", max: 300 },
  },
  cancelar: {
    titulo: "¿Cancelar esta salida?",
    descripcion: "La salida queda cancelada sin mover inventario. No se puede deshacer.",
    confirmar: "Cancelar salida",
    enCurso: "Cancelando…",
    peligro: true,
    campo: { etiqueta: "¿Por qué se cancela?", max: 300 },
  },
  retirar: {
    titulo: "¿Registrar el retiro?",
    descripcion: "Descuenta la existencia por PEPS y asigna folio. No se puede deshacer.",
    confirmar: "Registrar retiro",
    enCurso: "Registrando…",
    campo: { etiqueta: "¿Quién se lleva el material?", max: 120 },
  },
  recibir: {
    titulo: "¿Confirmar la recepción?",
    descripcion: "Confirma que la estación recibió el material. La salida queda cerrada.",
    confirmar: "Confirmar recepción",
    enCurso: "Confirmando…",
  },
};

export function AccionesSalida({ id, puede, acciones }: { id: string; puede: Facultades; acciones: Acciones }) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [dialogo, setDialogo] = useState<Clave | null>(null);
  const [texto, setTexto] = useState("");

  const ejecutar = (fn: () => Promise<ResultadoAccion>) =>
    iniciar(async () => {
      setMensaje(null);
      const r = await fn();
      if (r.ok) setDialogo(null);
      else setMensaje(r.mensaje);
      // También tras un error: si otro usuario ya la movió, la pantalla muestra dónde quedó.
      router.refresh();
    });

  // Si tras refrescar la acción ya no aplica, su diálogo se cierra y el aviso queda en la pantalla
  const vigente = dialogo && (dialogo === "rechazar" ? puede.autorizar : puede[dialogo]) ? dialogo : null;

  const abrir = (c: Clave) => {
    setTexto("");
    setMensaje(null);
    setDialogo(c);
  };
  const volver = () => {
    setMensaje(null);
    setDialogo(null);
  };
  const correr = (c: Clave) => (c === "autorizar" || c === "recibir" ? acciones[c](id) : acciones[c](id, texto));

  // Montado aunque no quede acción: así el aviso sobrevive si otro la cerró.
  if (!mensaje && !puede.autorizar && !puede.cancelar && !puede.retirar && !puede.recibir) return null;

  const d = vigente && DIALOGO[vigente];

  return (
    <div className="flex flex-col gap-3 border-t border-border px-5 py-4">
      {mensaje && !vigente && (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {mensaje}
        </p>
      )}

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
            <Button type="button" onClick={() => abrir("autorizar")} disabled={pendiente}>
              Autorizar
            </Button>
          )}
          {puede.retirar && (
            <Button type="button" onClick={() => abrir("retirar")} disabled={pendiente}>
              Registrar retiro
            </Button>
          )}
          {puede.recibir && (
            <Button type="button" onClick={() => abrir("recibir")} disabled={pendiente}>
              Confirmar recepción
            </Button>
          )}
        </span>
      </div>

      {vigente && d && (
        <DialogoConfirmacion
          titulo={d.titulo}
          descripcion={d.descripcion}
          campo={d.campo && { ...d.campo, valor: texto, alCambiar: setTexto }}
          confirmar={d.confirmar}
          enCurso={d.enCurso}
          peligro={d.peligro}
          pendiente={pendiente}
          mensaje={mensaje}
          alConfirmar={() => ejecutar(() => correr(vigente))}
          alCerrar={volver}
        />
      )}
    </div>
  );
}
