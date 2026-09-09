"use client";

import type { Rol } from "@prisma/client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox, Select } from "@/components/ui/campos";
import { ESTADO_INICIAL, type EstadoAcceso } from "@/lib/usuarios/formulario";
import { cn } from "@/lib/utils";

const ROLES: { valor: Rol; etiqueta: string; descripcion: string }[] = [
  { valor: "SUPERADMIN", etiqueta: "Superadmin", descripcion: "Todo, incluidos empresas y estaciones" },
  { valor: "COMPRAS", etiqueta: "Compras", descripcion: "Catálogos operativos y movimientos" },
  { valor: "JEFE", etiqueta: "Jefe", descripcion: "Solo consulta" },
];

export function FilaAcceso({
  clerkUserId,
  correo,
  nombre,
  rol,
  puedeAutorizar,
  activo,
  esTuCuenta,
  modo,
  accion,
}: {
  clerkUserId: string;
  correo: string | null;
  nombre: string | null;
  rol?: Rol;
  puedeAutorizar?: boolean;
  activo?: boolean;
  esTuCuenta?: boolean;
  modo: "con-acceso" | "sin-acceso";
  accion: (estado: EstadoAcceso, formData: FormData) => Promise<EstadoAcceso>;
}) {
  const [estado, enviar, enviando] = useActionState(accion, ESTADO_INICIAL);

  return (
    <form
      action={enviar}
      className="grid items-center gap-4 border-b border-border px-5 py-4 last:border-b-0 lg:grid-cols-[minmax(0,1fr)_9rem_7rem_6rem_auto]"
    >
      <input type="hidden" name="clerkUserId" value={clerkUserId} />

      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">
          {correo ?? <span className="text-muted">sin correo en Clerk</span>}
          {esTuCuenta && <span className="ml-2 text-xs text-muted">— tu cuenta</span>}
        </p>
        {nombre && <p className="truncate text-xs text-muted">{nombre}</p>}
        {estado.mensaje && (
          <p
            className={cn(
              "mt-1 text-xs",
              estado.tono === "error" ? "text-danger" : "text-success",
            )}
          >
            {estado.mensaje}
          </p>
        )}
      </div>

      <Select name="rol" defaultValue={rol ?? "JEFE"} aria-label="Rol">
        {ROLES.map((r) => (
          <option key={r.valor} value={r.valor} title={r.descripcion}>
            {r.etiqueta}
          </option>
        ))}
      </Select>

      <label className="flex items-center gap-2 text-sm text-muted-strong">
        <Checkbox name="puedeAutorizar" defaultChecked={puedeAutorizar ?? false} />
        Autoriza
      </label>

      {modo === "con-acceso" ? (
        <label className="flex items-center gap-2 text-sm text-muted-strong">
          <Checkbox name="activo" defaultChecked={activo ?? true} />
          Activo
        </label>
      ) : (
        <input type="hidden" name="activo" value="on" />
      )}

      <Button
        type="submit"
        variante={modo === "con-acceso" ? "secundario" : "primario"}
        tamano="sm"
        disabled={enviando}
      >
        {enviando ? "Guardando…" : modo === "con-acceso" ? "Guardar" : "Conceder acceso"}
      </Button>
    </form>
  );
}
