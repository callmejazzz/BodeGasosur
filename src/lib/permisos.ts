import type { Rol } from "@prisma/client";

export type Permiso =
  | "catalogos:leer"
  | "catalogos:operativos:escribir"
  | "catalogos:globales:escribir"
  | "usuarios:administrar"
  | "entradas:leer"
  | "entradas:capturar"
  | "entradas:confirmar"
  | "salidas:leer"
  | "salidas:capturar"
  | "salidas:autorizar"
  | "salidas:retirar"
  | "salidas:recibir";

export type SujetoDePermisos = { rol: Rol; puedeAutorizar: boolean };

export const PERMISOS: Record<Rol, readonly Permiso[]> = {
  SUPERADMIN: [
    "catalogos:leer",
    "catalogos:operativos:escribir",
    "catalogos:globales:escribir",
    "usuarios:administrar",
    "entradas:leer",
    "entradas:capturar",
    "entradas:confirmar",
    "salidas:leer",
    "salidas:capturar",
    "salidas:autorizar",
    "salidas:retirar",
    "salidas:recibir",
  ],
  COMPRAS: [
    "catalogos:leer",
    "catalogos:operativos:escribir",
    "entradas:leer",
    "entradas:capturar",
    "entradas:confirmar",
    "salidas:leer",
    "salidas:capturar",
    "salidas:autorizar",
    "salidas:retirar",
    "salidas:recibir",
  ],
  JEFE: ["catalogos:leer", "entradas:leer", "salidas:leer", "salidas:autorizar"],
};

export function rolTienePermiso(rol: Rol, permiso: Permiso): boolean {
  return PERMISOS[rol].includes(permiso);
}

/** La facultad de autorizar se consulta en PostgreSQL en cada petición. */
export function usuarioTienePermiso(usuario: SujetoDePermisos, permiso: Permiso): boolean {
  return rolTienePermiso(usuario.rol, permiso) &&
    (permiso !== "salidas:autorizar" || usuario.puedeAutorizar);
}
