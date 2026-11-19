"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { DialogoConfirmacion } from "@/components/ui/dialogo";
import type { ResultadoAccion } from "@/lib/inventario/acciones";
import { llamarAlServidor, resultadoSinConexion } from "@/lib/conexion";

/*
  La reversa de un movimiento cerrado. Solo se dibuja para el Superadmin y la
  acción vuelve a exigirlo. Crea otro asiento: al terminar se abre ese asiento.
*/

export function RevertirMovimiento({ id, folio, revertir }: { id: string; folio: string; revertir: (id: string, motivo: string) => Promise<ResultadoAccion> }) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [mensaje, setMensaje] = useState<string | null>(null);

  // El aviso pertenece a ese intento: al volver o abrir de nuevo se va.
  const abrir = () => {
    setMotivo("");
    setMensaje(null);
    setAbierto(true);
  };
  const volver = () => {
    setMensaje(null);
    setAbierto(false);
  };
  const registrar = () =>
    iniciar(async () => {
      setMensaje(null);
      const r = await llamarAlServidor(() => revertir(id, motivo), resultadoSinConexion);
      if (!r.ok) {
        setMensaje(r.mensaje);
        router.refresh();
      } else if (r.href) {
        router.push(r.href);
      }
    });

  return (
    <div className="flex justify-end border-t border-border px-5 py-4">
      <Button type="button" variante="secundario" onClick={abrir}>
        Revertir
      </Button>
      {abierto && (
        <DialogoConfirmacion
          titulo={`¿Revertir ${folio}?`}
          descripcion={`Crea un asiento inverso con folio propio. ${folio} no se borra ni se edita, y solo se revierte una vez.`}
          campo={{ etiqueta: `¿Por qué se revierte ${folio}?`, valor: motivo, alCambiar: setMotivo, max: 300 }}
          confirmar="Registrar reversa"
          enCurso="Revirtiendo…"
          peligro
          pendiente={pendiente}
          mensaje={mensaje}
          alConfirmar={registrar}
          alCerrar={volver}
        />
      )}
    </div>
  );
}
