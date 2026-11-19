// Cómo se explica cada negativa y cada fallo, en acciones y pantallas. La regla de negocio trae su propio motivo

export const SIN_SESION = "Tu sesión terminó. Recarga la página para volver a iniciar sesión.";
export const SIN_ACCESO = "Tu usuario ya no tiene acceso al sistema.";
export const SIN_PERMISO = "No tienes permiso para esta operación.";
export const FALLO_DEL_SERVIDOR = "No se pudo completar la operación por un fallo del servidor. Inténtalo de nuevo.";
export const SIN_CONEXION = "No se pudo comunicar con el servidor. Revisa tu conexión e inténtalo de nuevo.";

/** Next conserva el digest de un error hasta error.tsx: así la pantalla distingue la negativa de un fallo. */
export const DIGEST = {
  sinSesion: "bodegasosur:sin-sesion",
  sinAcceso: "bodegasosur:sin-acceso",
  sinPermiso: "bodegasosur:sin-permiso",
} as const;
