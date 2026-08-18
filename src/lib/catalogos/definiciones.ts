import { z } from "zod";

/**
 * Los catálogos se declaran, no se programan uno por uno.
 *
 * Compras va a renombrar campos, agregar catálogos y quitar otros durante el
 * levantamiento de requerimientos. Con esta definición, cada uno de esos cambios
 * es una entrada de configuración y no una pantalla nueva.
 */

export type FuenteOpciones = "unidades" | "categorias";

export type CampoDef = {
  nombre: string;
  etiqueta: string;
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
};

export type CatalogoDef = {
  slug: string;
  titulo: string;
  singular: string;
  /** Para redactar los textos: «el proveedor» vs «la bodega». */
  genero: "m" | "f";
  descripcion: string;
  campos: CampoDef[];
  /** Campos sobre los que aplica el buscador. */
  camposBusqueda: string[];
};

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

export const CATALOGOS: CatalogoDef[] = [
  {
    slug: "bodegas",
    titulo: "Bodegas",
    singular: "bodega",
    genero: "f",
    descripcion: "Almacenes del grupo desde donde sale y hacia donde entra el material.",
    camposBusqueda: ["clave", "nombre", "ubicacion"],
    campos: [
      {
        nombre: "clave",
        etiqueta: "Clave",
        tipo: "texto",
        requerido: true,
        placeholder: "BOD-04",
        sinSalto: true,
      },
      { nombre: "nombre", etiqueta: "Nombre", tipo: "texto", requerido: true, placeholder: "Bodega Poniente" },
      { nombre: "ubicacion", etiqueta: "Ubicación", tipo: "texto", placeholder: "Calle y número" },
      ESTADO_F,
    ],
  },
  {
    slug: "estaciones",
    titulo: "Estaciones",
    singular: "estación",
    genero: "f",
    descripcion: "Estaciones de servicio que reciben el material que sale de bodega.",
    camposBusqueda: ["clave", "nombre", "ubicacion"],
    campos: [
      {
        nombre: "clave",
        etiqueta: "Clave",
        tipo: "texto",
        requerido: true,
        placeholder: "EST-11",
        sinSalto: true,
      },
      { nombre: "nombre", etiqueta: "Nombre", tipo: "texto", requerido: true, placeholder: "Gasosur Poniente" },
      { nombre: "ubicacion", etiqueta: "Ubicación", tipo: "texto", placeholder: "Calle y número" },
      ESTADO_F,
    ],
  },
  {
    slug: "areas",
    titulo: "Áreas",
    singular: "área",
    genero: "f",
    descripcion:
      "Área de la estación a la que se destina el material: despacho, tienda, mantenimiento…",
    camposBusqueda: ["nombre"],
    campos: [
      { nombre: "nombre", etiqueta: "Nombre", tipo: "texto", requerido: true, placeholder: "Mantenimiento" },
      ESTADO_F,
    ],
  },
  {
    slug: "unidades",
    titulo: "Unidades de medida",
    singular: "unidad de medida",
    genero: "f",
    descripcion: "Cómo se cuenta cada artículo: pieza, litro, caja, kilogramo…",
    camposBusqueda: ["clave", "nombre"],
    campos: [
      {
        nombre: "clave",
        etiqueta: "Clave",
        tipo: "texto",
        requerido: true,
        placeholder: "PZA",
        sinSalto: true,
      },
      { nombre: "nombre", etiqueta: "Nombre", tipo: "texto", requerido: true, placeholder: "Pieza" },
      ESTADO_F,
    ],
  },
  {
    slug: "categorias",
    titulo: "Categorías",
    singular: "categoría",
    genero: "f",
    descripcion: "Clasificación de los artículos para agrupar consultas y reportes.",
    camposBusqueda: ["nombre"],
    campos: [
      { nombre: "nombre", etiqueta: "Nombre", tipo: "texto", requerido: true, placeholder: "Herramienta" },
      ESTADO_F,
    ],
  },
  {
    slug: "articulos",
    titulo: "Artículos",
    singular: "artículo",
    genero: "m",
    descripcion: "El material que se controla. Cada artículo tiene una unidad de medida fija.",
    camposBusqueda: ["clave", "descripcion"],
    campos: [
      {
        nombre: "clave",
        etiqueta: "Clave",
        tipo: "texto",
        requerido: true,
        placeholder: "REF-1009",
        sinSalto: true,
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
    titulo: "Proveedores",
    singular: "proveedor",
    genero: "m",
    descripcion: "A quién se le compra el material que entra a bodega.",
    camposBusqueda: ["razonSocial", "rfc", "contacto"],
    campos: [
      { nombre: "razonSocial", etiqueta: "Razón social", tipo: "texto", requerido: true },
      { nombre: "rfc", etiqueta: "RFC", tipo: "texto", placeholder: "XAXX010101000" },
      { nombre: "contacto", etiqueta: "Contacto", tipo: "texto" },
      { nombre: "telefono", etiqueta: "Teléfono", tipo: "texto" },
      ESTADO_M,
    ],
  },
  {
    slug: "personas",
    titulo: "Personas",
    singular: "persona",
    genero: "f",
    descripcion:
      "Quién solicita, quién autoriza, quién transporta y quién recibe. Hoy se captura; cuando exista autenticación, estas personas se enlazan con usuarios del sistema.",
    camposBusqueda: ["nombre", "puesto"],
    campos: [
      { nombre: "nombre", etiqueta: "Nombre", tipo: "texto", requerido: true },
      { nombre: "puesto", etiqueta: "Puesto", tipo: "texto", placeholder: "Almacenista" },
      {
        nombre: "esTransportista",
        etiqueta: "Puede transportar material",
        tipo: "booleano",
        ayuda: "Aparecerá en la lista de transportistas al capturar una salida o traspaso.",
      },
      ESTADO_F,
    ],
  },
];

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
 */
export function esquemaDe(def: CatalogoDef) {
  const forma: Record<string, z.ZodTypeAny> = {};

  for (const campo of def.campos) {
    switch (campo.tipo) {
      case "booleano":
        // Un checkbox no marcado sencillamente no se envía en el FormData.
        forma[campo.nombre] = z
          .union([z.literal("on"), z.literal("true"), z.undefined(), z.null()])
          .transform((v) => v === "on" || v === "true");
        break;

      case "numero":
        forma[campo.nombre] = z.coerce
          .number({ error: "Debe ser un número" })
          .min(0, "No puede ser negativo")
          .default(0);
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
