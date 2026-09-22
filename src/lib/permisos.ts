import type { Rol } from "@prisma/client";

export type Permiso =
  | "catalogos:leer"
  | "catalogos:operativos:escribir"
  | "catalogos:globales:escribir"
  | "usuarios:administrar"
  | "entradas:leer"
  | "entradas:capturar"
  | "entradas:confirmar";

export const PERMISOS: Record<Rol, readonly Permiso[]> = {
  SUPERADMIN: [
    "catalogos:leer",
    "catalogos:operativos:escribir",
    "catalogos:globales:escribir",
    "usuarios:administrar",
    "entradas:leer",
    "entradas:capturar",
    "entradas:confirmar",
  ],
  COMPRAS: [
    "catalogos:leer",
    "catalogos:operativos:escribir",
    "entradas:leer",
    "entradas:capturar",
    "entradas:confirmar",
  ],
  JEFE: ["catalogos:leer", "entradas:leer"],
};

export function rolTienePermiso(rol: Rol, permiso: Permiso): boolean {
  return PERMISOS[rol].includes(permiso);
}
