export type MiCuenta = { correo: string; alertasCorreo: boolean };

export type EstadoCuenta = {
  mensaje: string | null;
  tono: "exito" | "error" | null;
};

export const ESTADO_INICIAL: EstadoCuenta = { mensaje: null, tono: null };

export const HORARIO_DE_ALERTA = "Todos los días a las 8:00 a. m., hora de la CDMX";
