import type { CausaDeExclusion } from "@/lib/correo/exclusion";
import type { EstadoDelAviso } from "@/lib/correo/entrega";

export type AvisoDelDia = "SIN_BAJO_MINIMO" | "EMPIEZA_MANIANA";

export type MiCuenta = {
  correo: string;
  alertasCorreo: boolean;
  ultimoAviso: { fecha: string; estado: EstadoDelAviso } | null;
  exclusion: CausaDeExclusion | null;
  avisoDelDia: AvisoDelDia | null;
};

export type EstadoCuenta = {
  mensaje: string | null;
  tono: "exito" | "error" | null;
};

export const ESTADO_INICIAL: EstadoCuenta = { mensaje: null, tono: null };

export const HORARIO_DE_ALERTA = "Todos los días a las 8:00 a. m., hora de la CDMX";
