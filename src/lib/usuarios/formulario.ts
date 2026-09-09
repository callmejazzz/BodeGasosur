/** Estado que la acción de acceso devuelve a cada fila del formulario. */
export type EstadoAcceso = {
  mensaje: string | null;
  tono: "exito" | "error" | null;
};

export const ESTADO_INICIAL: EstadoAcceso = { mensaje: null, tono: null };
