export type ValoresFormulario = Record<string, string | boolean>;

/** Estado que devuelve la acción de servidor al formulario de catálogos. */
export type EstadoFormulario = {
  errores: Record<string, string>;
  mensaje: string | null;
  /**
   * Lo que el usuario acababa de capturar.
   *
   * React 19 reinicia los campos no controlados cuando termina una acción de
   * formulario. Sin devolver estos valores, un error de validación borraría
   * toda la captura — inaceptable en pantallas de varios campos.
   */
  valores?: ValoresFormulario;
};

export const ESTADO_INICIAL: EstadoFormulario = { errores: {}, mensaje: null };
