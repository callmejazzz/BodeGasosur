// Una tabla lista para pantalla y para Excel: las mismas columnas y filas.

/** Cómo se escribe cada celda: los números van como número, las fechas como fecha de Excel. */
export type Formato = "texto" | "entero" | "importe" | "costo" | "fecha" | "instante";

/** `string` en entero, importe o costo es el decimal tal cual lo dio PostgreSQL. Nulo es celda vacía. */
export type Valor = string | number | Date | null | undefined;

export type Columna<F> = {
  titulo: string;
  formato: Formato;
  valor: (fila: F) => Valor;
  /** Solo en pantalla: a dónde lleva la celda. */
  enlace?: (fila: F) => string | null;
  /** Solo en pantalla: el valor como insignia. */
  insignia?: "aviso" | "peligro" | "info";
};

export type Hoja<F = never> = {
  /** El nombre de la pestaña. */
  nombre: string;
  titulo: string;
  /** Los filtros ya normalizados, como se aplicaron: [etiqueta, valor]. */
  filtros: [string, string][];
  columnas: Columna<F>[];
  filas: F[];
};

/** Para juntar hojas de filas distintas en un libro. */
export const hoja = <F>(h: Hoja<F>) => h as unknown as Hoja<unknown>;
