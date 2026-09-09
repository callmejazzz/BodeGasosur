import type { Permiso } from "@/lib/permisos";
import { z } from "zod";

/**
 * Los catálogos se declaran, no se programan uno por uno.
 *
 * Compras va a renombrar campos, agregar catálogos y quitar otros durante el
 * levantamiento de requerimientos. Con esta definición, cada uno de esos cambios
 * es una entrada de configuración y no una pantalla nueva.
 */

export type FuenteOpciones = "unidades" | "categorias" | "empresas";

export type CampoDef = {
  nombre: string;
  etiqueta: string;
  /** `numero` son piezas enteras: en este sistema no hay medias piezas. */
  tipo: "texto" | "numero" | "booleano" | "select";
  requerido?: boolean;
  placeholder?: string;
  ayuda?: string;
  /** Catálogo del que se obtienen las opciones cuando el tipo es `select`. */
  fuente?: FuenteOpciones;
  /** Ruta para leer el valor mostrado en la tabla, p. ej. `unidad.clave`. */
  rutaTabla?: string;
  ocultarEnTabla?: boolean;
  /** Evita que la columna parta el valor en dos renglones (claves, folios). */
  sinSalto?: boolean;
  alineacion?: "izquierda" | "derecha";
  /** Marca el campo activo/activa, que se dibuja como etiqueta de estado. */
  esEstado?: boolean;

  /**
   * Lo asigna PostgreSQL, no quien captura. Nunca se envía en el formulario:
   * en el alta se muestra vacío y en la edición, de solo lectura.
   */
  generado?: boolean;

  /**
   * Clave de negocio: se captura al dar de alta y después no se puede cambiar.
   * Vive en la URL y en los WhatsApp de Compras, así que cambiarla rompe
   * enlaces ajenos. Un trigger lo impide también en la base; esto solo evita
   * que la pantalla ofrezca algo que va a fallar.
   */
  inmutable?: boolean;
};

export type CatalogoDef = {
  slug: string;
  titulo: string;
  /**
   * Permiso que exige escribir este catálogo. Empresa y Estacion viven en el
   * esquema global del grupo y solo las escribe el Superadmin (01 §3.3); por
   * eso el permiso viaja con la definición y no en un condicional sobre el
   * slug: agregar un catálogo sigue siendo una entrada de configuración.
   */
  permisoEscritura: Permiso;
  singular: string;
  /** Para redactar los textos: «el proveedor» vs «la bodega». */
  genero: "m" | "f";
  descripcion: string;
  campos: CampoDef[];
  /** Campos sobre los que aplica el buscador. Admite rutas: `empresa.razonSocial`. */
  camposBusqueda: string[];
  /** Campo que encabeza la pantalla de edición. */
  campoTitulo: string;
};

/** Si el campo llega o no dentro del FormData, según se esté dando de alta o editando. */
export function campoSeCaptura(campo: CampoDef, modo: ModoFormulario): boolean {
  if (campo.generado) return false;
  if (campo.inmutable && modo === "edicion") return false;
  return true;
}

export type ModoFormulario = "alta" | "edicion";

const ESTADO_F: CampoDef = {
  nombre: "activa",
  etiqueta: "Activa",
  tipo: "booleano",
  esEstado: true,
};

const ESTADO_M: CampoDef = {
  nombre: "activo",
  etiqueta: "Activo",
  tipo: "booleano",
  esEstado: true,
};

const EMPRESA: CampoDef = {
  nombre: "empresaId",
  etiqueta: "Empresa",
  tipo: "select",
  requerido: true,
  fuente: "empresas",
  rutaTabla: "empresa.razonSocial",
};

export const CATALOGOS: CatalogoDef[] = [
  {
    slug: "empresas",
    permisoEscritura: "catalogos:globales:escribir",
    titulo: "Empresas",
    singular: "empresa",
    genero: "f",
    descripcion:
      "Las razones sociales del grupo. Viven en el catálogo global que otros sistemas de Gasosur leen, y de ellas cuelgan las estaciones y los proveedores.",
    camposBusqueda: ["razonSocial", "rfc"],
    campoTitulo: "razonSocial",
    campos: [
      {
        nombre: "razonSocial",
        etiqueta: "Razón social",
        tipo: "texto",
        requerido: true,
        placeholder: "Combustibles del Pacífico Sur, S.A. de C.V.",
      },
      {
        nombre: "rfc",
        etiqueta: "RFC",
        tipo: "texto",
        placeholder: "CPS980412H23",
        ayuda: "Se guarda en mayúsculas, sin guiones ni espacios.",
        sinSalto: true,
      },
      ESTADO_F,
    ],
  },
  {
    slug: "bodegas",
    permisoEscritura: "catalogos:operativos:escribir",
    titulo: "Bodegas",
    singular: "bodega",
    genero: "f",
    descripcion: "Almacenes del grupo desde donde sale y hacia donde entra el material.",
    camposBusqueda: ["clave", "nombre", "ubicacion"],
    campoTitulo: "nombre",
    campos: [
      {
        nombre: "clave",
        etiqueta: "Clave",
        tipo: "texto",
        requerido: true,
        inmutable: true,
        placeholder: "MAG",
        sinSalto: true,
      },
      { nombre: "nombre", etiqueta: "Nombre", tipo: "texto", requerido: true, placeholder: "Magallanes" },
      { nombre: "ubicacion", etiqueta: "Ubicación", tipo: "texto", placeholder: "Calle y número" },
      ESTADO_F,
    ],
  },
  {
    slug: "estaciones",
    permisoEscritura: "catalogos:globales:escribir",
    titulo: "Estaciones",
    singular: "estación",
    genero: "f",
    descripcion: "Estaciones de servicio que reciben el material que sale de bodega.",
    camposBusqueda: ["numero", "alias", "empresa.razonSocial"],
    campoTitulo: "alias",
    campos: [
      {
        nombre: "numero",
        etiqueta: "Número",
        tipo: "texto",
        requerido: true,
        inmutable: true,
        placeholder: "ES05588",
        sinSalto: true,
      },
      { nombre: "alias", etiqueta: "Alias", tipo: "texto", requerido: true, placeholder: "Magallanes" },
      EMPRESA,
      { nombre: "telefono", etiqueta: "Teléfono", tipo: "texto", placeholder: "744 155 4420" },
      { nombre: "movil", etiqueta: "Móvil", tipo: "texto", ocultarEnTabla: true },
      { nombre: "correo", etiqueta: "Correo", tipo: "texto", ocultarEnTabla: true },
      ESTADO_F,
    ],
  },
  {
    slug: "areas",
    permisoEscritura: "catalogos:operativos:escribir",
    titulo: "Áreas",
    singular: "área",
    genero: "f",
    descripcion:
      "Área de la estación a la que se destina el material: administración, mantenimiento y despacho.",
    camposBusqueda: ["nombre"],
    campoTitulo: "nombre",
    campos: [
      { nombre: "nombre", etiqueta: "Nombre", tipo: "texto", requerido: true, placeholder: "Mantenimiento" },
      ESTADO_F,
    ],
  },
  {
    slug: "unidades",
    permisoEscritura: "catalogos:operativos:escribir",
    titulo: "Unidades de medida",
    singular: "unidad de medida",
    genero: "f",
    descripcion:
      "La presentación en la que se cuenta el artículo, no una magnitud: una cubeta de 19 litros es 1 CUB, no 19 LT. La existencia se lleva siempre en piezas enteras.",
    camposBusqueda: ["clave", "nombre"],
    campoTitulo: "nombre",
    campos: [
      {
        nombre: "clave",
        etiqueta: "Clave",
        tipo: "texto",
        requerido: true,
        inmutable: true,
        placeholder: "PZA",
        sinSalto: true,
      },
      { nombre: "nombre", etiqueta: "Nombre", tipo: "texto", requerido: true, placeholder: "Pieza" },
      ESTADO_F,
    ],
  },
  {
    slug: "categorias",
    permisoEscritura: "catalogos:operativos:escribir",
    titulo: "Categorías",
    singular: "categoría",
    genero: "f",
    descripcion: "Clasificación de los artículos para agrupar consultas y reportes.",
    camposBusqueda: ["nombre"],
    campoTitulo: "nombre",
    campos: [
      { nombre: "nombre", etiqueta: "Nombre", tipo: "texto", requerido: true, placeholder: "Herramienta" },
      ESTADO_F,
    ],
  },
  {
    slug: "articulos",
    permisoEscritura: "catalogos:operativos:escribir",
    titulo: "Artículos",
    singular: "artículo",
    genero: "m",
    descripcion: "El material que se controla. Cada artículo tiene una unidad de medida fija.",
    camposBusqueda: ["clave", "descripcion"],
    campoTitulo: "descripcion",
    campos: [
      {
        nombre: "clave",
        etiqueta: "Clave",
        tipo: "texto",
        generado: true,
        sinSalto: true,
        ayuda: "La asigna el sistema al guardar y no se puede cambiar.",
      },
      {
        nombre: "descripcion",
        etiqueta: "Descripción",
        tipo: "texto",
        requerido: true,
        placeholder: "Manguera de despacho 3/4\" x 4 m",
      },
      {
        nombre: "unidadId",
        etiqueta: "Unidad de medida",
        tipo: "select",
        requerido: true,
        fuente: "unidades",
        rutaTabla: "unidad.clave",
      },
      {
        nombre: "categoriaId",
        etiqueta: "Categoría",
        tipo: "select",
        fuente: "categorias",
        rutaTabla: "categoria.nombre",
      },
      {
        nombre: "piezasPorCaja",
        etiqueta: "Piezas por caja",
        tipo: "numero",
        alineacion: "derecha",
        ayuda: "Para capturar en cajas y guardar en piezas. Déjalo vacío si no aplica.",
      },
      {
        nombre: "stockMinimo",
        etiqueta: "Stock mínimo",
        tipo: "numero",
        alineacion: "derecha",
        ayuda: "Debajo de esta cantidad el artículo se marca en el tablero.",
      },
      ESTADO_M,
    ],
  },
  {
    slug: "proveedores",
    permisoEscritura: "catalogos:operativos:escribir",
    titulo: "Proveedores",
    singular: "proveedor",
    genero: "m",
    descripcion:
      "A quién se le compra el material que entra a bodega. La razón social y el RFC viven en la empresa: buena parte de los proveedores son del propio grupo.",
    camposBusqueda: ["nombreComercial", "contacto", "giro", "empresa.razonSocial"],
    campoTitulo: "nombreComercial",
    campos: [
      {
        nombre: "nombreComercial",
        etiqueta: "Nombre comercial",
        tipo: "texto",
        requerido: true,
        placeholder: "Refaccionaria del Golfo",
      },
      EMPRESA,
      { nombre: "giro", etiqueta: "Giro", tipo: "texto", placeholder: "Refacciones" },
      { nombre: "contacto", etiqueta: "Contacto", tipo: "texto" },
      { nombre: "telefono", etiqueta: "Teléfono", tipo: "texto" },
      { nombre: "correo", etiqueta: "Correo", tipo: "texto", ocultarEnTabla: true },
      ESTADO_M,
    ],
  },
  {
    slug: "personas",
    permisoEscritura: "catalogos:operativos:escribir",
    titulo: "Personas",
    singular: "persona",
    genero: "f",
    descripcion:
      "Quién solicita el material. Puede no tener cuenta en el sistema: el gerente pide por WhatsApp y Compras captura a su nombre. Quien autoriza sí es siempre un usuario.",
    camposBusqueda: ["nombre", "puesto"],
    campoTitulo: "nombre",
    campos: [
      { nombre: "nombre", etiqueta: "Nombre", tipo: "texto", requerido: true },
      { nombre: "puesto", etiqueta: "Puesto", tipo: "texto", placeholder: "Almacenista" },
      ESTADO_F,
    ],
  },
];

/**
 * Si el catálogo tiene algún `select` que llenar.
 *
 * Solo tres de los nueve lo tienen —estaciones, artículos y proveedores—, y
 * `cargarOpciones()` cuesta tres lecturas. Preguntarlo antes evita pagarlas en
 * los otros seis, donde no hay ni un desplegable que alimentar.
 */
export function necesitaOpciones(def: CatalogoDef): boolean {
  return def.campos.some((campo) => campo.tipo === "select");
}

export function catalogoPorSlug(slug: string): CatalogoDef | undefined {
  return CATALOGOS.find((c) => c.slug === slug);
}

export function campoEstado(def: CatalogoDef): CampoDef | undefined {
  return def.campos.find((c) => c.esEstado);
}

/** El artículo determinado que corresponde al género del catálogo. */
export function elLa(def: CatalogoDef): string {
  return def.genero === "f" ? "la" : "el";
}

/**
 * Construye el esquema de validación a partir de la misma definición que dibuja
 * el formulario, para que nunca se separen.
 *
 * El modo importa: una clave de negocio se captura al dar de alta y deja de
 * enviarse al editar, así que exigirla en la edición rechazaría una captura
 * correcta.
 */
export function esquemaDe(def: CatalogoDef, modo: ModoFormulario) {
  const forma: Record<string, z.ZodTypeAny> = {};

  for (const campo of def.campos) {
    if (!campoSeCaptura(campo, modo)) continue;

    switch (campo.tipo) {
      case "booleano":
        // Un checkbox no marcado sencillamente no se envía en el FormData.
        //
        // El `.optional()` no sobra aunque la unión ya acepte `undefined`: en
        // Zod 4 el `.transform()` envuelve el esquema en un pipe, y la llave
        // pasa a ser obligatoria: una llave AUSENTE falla con «expected
        // nonoptional». Sin esta línea no se puede desactivar ningún registro.
        forma[campo.nombre] = z
          .union([z.literal("on"), z.literal("true"), z.undefined(), z.null()])
          .optional()
          .transform((v) => v === "on" || v === "true");
        break;

      case "numero":
        // Enteros: son piezas, y en una bodega no hay medias piezas.
        forma[campo.nombre] = campo.requerido
          ? z.coerce
              .number({ error: "Debe ser un número" })
              .int("Debe ser un número entero de piezas")
              .min(0, "No puede ser negativo")
          : z
              // Mismo motivo que en el booleano: el pipe del transform vuelve
              // obligatoria la llave. Aquí no se manifiesta —un input numérico
              // siempre se envía, aunque sea vacío— pero el defecto es el mismo.
              .union([z.literal(""), z.undefined(), z.null(), z.coerce.number()])
              .optional()
              .transform((v) => (v === "" || v === undefined || v === null ? null : Number(v)))
              .refine((v) => v === null || Number.isInteger(v), "Debe ser un número entero de piezas")
              .refine((v) => v === null || v >= 0, "No puede ser negativo");
        break;

      case "select":
        forma[campo.nombre] = campo.requerido
          ? z.string().min(1, "Selecciona una opción")
          : z
              .string()
              .optional()
              .transform((v) => (v && v.length > 0 ? v : null));
        break;

      default:
        forma[campo.nombre] = campo.requerido
          ? z.string().trim().min(1, "Este dato es obligatorio")
          : z
              .string()
              .trim()
              .optional()
              .transform((v) => (v && v.length > 0 ? v : null));
    }
  }

  return z.object(forma);
}

/**
 * Valores ya validados por Zod. El esquema se arma en tiempo de ejecución a partir
 * de la definición, así que aquí llegan sin tipo estático: los repos los leen con
 * los lectores tolerantes de `repos.ts`.
 */
export type ValoresCatalogo = Record<string, unknown>;
