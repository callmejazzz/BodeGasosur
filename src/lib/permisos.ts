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
  | "salidas:recibir"
  | "traspasos:leer"
  | "traspasos:capturar"
  | "traspasos:confirmar"
  | "devoluciones:leer"
  | "devoluciones:capturar"
  | "devoluciones:confirmar"
  | "ajustes:leer"
  | "ajustes:capturar"
  | "ajustes:confirmar"
  | "movimientos:revertir";

export type SujetoDePermisos = { rol: Rol; puedeAutorizar: boolean };

/** Traspasos, devoluciones y conteo: Superadmin y Compras leen, capturan y confirman (fase 7). */
const INVENTARIO = [
  "traspasos:leer",
  "traspasos:capturar",
  "traspasos:confirmar",
  "devoluciones:leer",
  "devoluciones:capturar",
  "devoluciones:confirmar",
  "ajustes:leer",
  "ajustes:capturar",
  "ajustes:confirmar",
] as const satisfies readonly Permiso[];

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
    ...INVENTARIO,
    // La reversa corrige un asiento cerrado: solo el Superadmin.
    "movimientos:revertir",
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
    ...INVENTARIO,
  ],
  JEFE: ["catalogos:leer", "entradas:leer", "salidas:leer", "salidas:autorizar", "traspasos:leer", "devoluciones:leer", "ajustes:leer"],
};

export function rolTienePermiso(rol: Rol, permiso: Permiso): boolean {
  return PERMISOS[rol].includes(permiso);
}

/** La facultad de autorizar se consulta en PostgreSQL en cada petición. */
export function usuarioTienePermiso(usuario: SujetoDePermisos, permiso: Permiso): boolean {
  return rolTienePermiso(usuario.rol, permiso) &&
    (permiso !== "salidas:autorizar" || usuario.puedeAutorizar);
}
