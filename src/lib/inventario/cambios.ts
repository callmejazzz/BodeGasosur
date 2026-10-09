/*
  La marca de «cambios sin guardar» de una captura que se guarda sin salir de
  la pantalla. Cuenta ediciones: un guardado solo limpia las que llevaba al
  enviarse, y solo cuando el servidor responde que quedó guardado. Lo editado
  mientras viajaba, o un guardado rechazado, siguen pendientes.
*/

export type Cambios = { hechas: number; guardadas: number };

export const SIN_CAMBIOS: Cambios = { hechas: 0, guardadas: 0 };

export const editar = (c: Cambios): Cambios => ({ ...c, hechas: c.hechas + 1 });

/** El servidor guardó lo que llevaba el envío hecho con `enviadas` ediciones. */
export const guardado = (c: Cambios, enviadas: number): Cambios => ({ ...c, guardadas: Math.max(c.guardadas, enviadas) });

export const haySinGuardar = (c: Cambios) => c.hechas !== c.guardadas;
