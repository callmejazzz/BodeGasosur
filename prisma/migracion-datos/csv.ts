import { readFileSync } from "node:fs";

// Lector de CSV mínimo para los archivos del corte.
export type Renglon = {
  /** Número de renglón en el archivo, contando el encabezado, para los mensajes. */
  linea: number;
  /** Valor de una columna, ya sin espacios sobrantes. Vacío si no existe. */
  col: (encabezado: string) => string;
};

export function leerCsv(ruta: string): Renglon[] {
  const contenido = readFileSync(ruta, "utf8").replace(/^\uFEFF/, "");
  const filas = parsear(contenido);
  if (filas.length === 0) throw new Error(`${ruta}: el archivo está vacío.`);

  const encabezados = filas[0].map(clave);
  const renglones: Renglon[] = [];

  filas.slice(1).forEach((celdas, i) => {
    // Un renglón sin nada capturado es el final de la hoja, no un dato.
    if (celdas.every((c) => c.trim() === "")) return;

    renglones.push({
      linea: i + 2,
      col: (encabezado) => {
        const indice = encabezados.indexOf(clave(encabezado));
        return indice === -1 ? "" : compactar(celdas[indice] ?? "");
      },
    });
  });

  return renglones;
}

/** Espacios, tabuladores y saltos sobrantes fuera, incluidos los de en medio. */
function compactar(valor: string): string {
  return valor.replace(/\s+/g, " ").trim();
}

function clave(encabezado: string): string {
  return compactar(encabezado)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function parsear(texto: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = "";
  let entreComillas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];

    if (entreComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          celda += '"';
          i++;
        } else {
          entreComillas = false;
        }
      } else {
        celda += c;
      }
      continue;
    }

    if (c === '"') {
      entreComillas = true;
    } else if (c === ",") {
      fila.push(celda);
      celda = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      fila.push(celda);
      filas.push(fila);
      fila = [];
      celda = "";
    } else {
      celda += c;
    }
  }

  if (celda.length > 0 || fila.length > 0) {
    fila.push(celda);
    filas.push(fila);
  }

  return filas;
}
