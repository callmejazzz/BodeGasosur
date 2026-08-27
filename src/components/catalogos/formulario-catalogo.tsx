"use client";

import { useActionState } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Campo, Checkbox, Input, Select } from "@/components/ui/campos";
import {
  campoSeCaptura,
  type CatalogoDef,
  type ModoFormulario,
} from "@/lib/catalogos/definiciones";
import {
  ESTADO_INICIAL,
  type EstadoFormulario,
  type ValoresFormulario,
} from "@/lib/catalogos/formulario";
import type { Opcion } from "@/lib/catalogos/repos";

export function FormularioCatalogo({
  def,
  modo,
  opciones,
  valores,
  accion,
  textoGuardar,
}: {
  def: CatalogoDef;
  modo: ModoFormulario;
  opciones: Record<string, Opcion[]>;
  valores: ValoresFormulario;
  accion: (estado: EstadoFormulario, formData: FormData) => Promise<EstadoFormulario>;
  textoGuardar: string;
}) {
  const [estado, enviar, enviando] = useActionState(accion, ESTADO_INICIAL);

  // Tras un error, lo recién capturado gana sobre lo que había guardado.
  const actuales = estado.valores ?? valores;

  return (
    <form action={enviar} className="flex flex-col gap-5 px-5 py-5">
      {estado.mensaje && (
        <p
          role="alert"
          className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          {estado.mensaje}
        </p>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        {def.campos.map((campo) => {
          const error = estado.errores[campo.nombre];
          const valor = actuales[campo.nombre];

          // La clave que genera PostgreSQL y las claves de negocio ya dadas de
          // alta se muestran, pero no se capturan: un input deshabilitado no
          // viaja en el FormData, así que la pantalla no puede ni intentar
          // escribir lo que la base va a rechazar.
          if (!campoSeCaptura(campo, modo)) {
            const vacio = valor === "" || valor === undefined || valor === null;
            return (
              <Campo
                key={campo.nombre}
                etiqueta={campo.etiqueta}
                ayuda={
                  campo.generado
                    ? "La asigna el sistema y no se puede cambiar."
                    : "Se define al dar de alta y ya no se puede cambiar."
                }
              >
                <Input
                  disabled
                  readOnly
                  value={vacio ? "" : String(valor)}
                  placeholder={campo.generado ? "Se asignará al guardar" : undefined}
                  className="bg-surface-muted text-muted"
                />
              </Campo>
            );
          }

          if (campo.tipo === "booleano") {
            return (
              <div key={campo.nombre} className="sm:col-span-2">
                <label className="flex items-start gap-2.5">
                  <Checkbox
                    name={campo.nombre}
                    defaultChecked={valor === true}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block text-sm font-medium text-muted-strong">
                      {campo.etiqueta}
                    </span>
                    {campo.ayuda && (
                      <span className="block text-xs text-muted">{campo.ayuda}</span>
                    )}
                  </span>
                </label>
              </div>
            );
          }

          if (campo.tipo === "select") {
            const lista = campo.fuente ? (opciones[campo.fuente] ?? []) : [];
            return (
              <Campo
                key={campo.nombre}
                etiqueta={campo.etiqueta}
                requerido={campo.requerido}
                ayuda={campo.ayuda}
                error={error}
              >
                <Select name={campo.nombre} defaultValue={String(valor ?? "")}>
                  <option value="">— Sin especificar —</option>
                  {lista.map((o) => (
                    <option key={o.valor} value={o.valor}>
                      {o.etiqueta}
                    </option>
                  ))}
                </Select>
              </Campo>
            );
          }

          return (
            <Campo
              key={campo.nombre}
              etiqueta={campo.etiqueta}
              requerido={campo.requerido}
              ayuda={campo.ayuda}
              error={error}
            >
              <Input
                name={campo.nombre}
                type={campo.tipo === "numero" ? "number" : "text"}
                step={campo.tipo === "numero" ? "0.001" : undefined}
                min={campo.tipo === "numero" ? "0" : undefined}
                defaultValue={String(valor ?? "")}
                placeholder={campo.placeholder}
                className={campo.tipo === "numero" ? "tabular" : undefined}
              />
            </Campo>
          );
        })}
      </div>

      <div className="flex items-center gap-2 border-t border-border pt-4">
        <Button type="submit" disabled={enviando}>
          {enviando ? "Guardando…" : textoGuardar}
        </Button>
        <ButtonLink href={`/catalogos/${def.slug}`} variante="secundario">
          Cancelar
        </ButtonLink>
      </div>
    </form>
  );
}
