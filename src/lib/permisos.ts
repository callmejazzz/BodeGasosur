import type { Rol } from "@prisma/client";

/**
 * Qué puede hacer cada rol.
 *
 * Es una tabla de datos tipada y no un `switch` repartido por el código
 * (01 §3.3): agregar un rol al enum hace que TypeScript señale este archivo
 * y exija decidir. Con condicionales repartidos no señala nada y el olvido
 * se descubre en producción.
 *
 * Lo que NO vive aquí es quién tiene cada rol: eso es `Usuario.rol`, un dato.
 * Y la facultad de autorizar tampoco es un permiso de esta tabla: es
 * `Usuario.puedeAutorizar`, una bandera editable independiente del rol.
 */
export type Permiso =
  | "catalogos:leer"
  | "catalogos:operativos:escribir"
  | "catalogos:globales:escribir"
  | "usuarios:administrar";

/**
 * La separación entre catálogos operativos y globales no es un capricho de
 * nomenclatura: `Empresa` y `Estacion` viven en el esquema `catalogo_gasosur`
 * y otros sistemas del grupo las leen, así que un cambio ahí sale de
 * BodeGasosur (01 §3.3). El permiso espeja una frontera que la base ya tiene.
 */
export const PERMISOS: Record<Rol, readonly Permiso[]> = {
  SUPERADMIN: [
    "catalogos:leer",
    "catalogos:operativos:escribir",
    "catalogos:globales:escribir",
    "usuarios:administrar",
  ],
  COMPRAS: ["catalogos:leer", "catalogos:operativos:escribir"],
  JEFE: ["catalogos:leer"],
};

export function rolTienePermiso(rol: Rol, permiso: Permiso): boolean {
  return PERMISOS[rol].includes(permiso);
}
