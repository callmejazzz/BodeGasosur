/*
  Lee un .xlsx para las pruebas: sus archivos desde el directorio central del
  ZIP y, de una hoja, sus celdas como texto.
*/

import { inflateRawSync } from "node:zlib";

/** Los archivos de un ZIP, leídos desde su directorio central. */
export function leerZip(zip: Buffer): Record<string, string> {
  const fin = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const total = zip.readUInt16LE(fin + 10);
  let p = zip.readUInt32LE(fin + 16);
  const archivos: Record<string, string> = {};
  for (let i = 0; i < total; i++) {
    const comprimido = zip.readUInt32LE(p + 20);
    const largoNombre = zip.readUInt16LE(p + 28);
    const local = zip.readUInt32LE(p + 42);
    const nombre = zip.subarray(p + 46, p + 46 + largoNombre).toString("utf8");
    const inicio = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    archivos[nombre] = inflateRawSync(zip.subarray(inicio, inicio + comprimido)).toString("utf8");
    p += 46 + largoNombre + zip.readUInt16LE(p + 30) + zip.readUInt16LE(p + 32);
  }
  return archivos;
}

/** Las filas de una hoja a partir de `desde`, cada celda como su texto o su número. */
export function celdas(hojaXml: string, desde = 1): string[][] {
  const filas: string[][] = [];
  for (const [, n, contenido] of hojaXml.matchAll(/<row r="(\d+)"(?:\/>|>(.*?)<\/row>)/g)) {
    if (Number(n) < desde) continue;
    const fila: string[] = [];
    for (const [, ref, cuerpo] of (contenido ?? "").matchAll(/<c r="([A-Z]+)\d+"[^>]*>(.*?)<\/c>/g)) {
      const columna = [...ref].reduce((n, l) => n * 26 + l.charCodeAt(0) - 64, 0) - 1;
      fila[columna] = /<v>(.*)<\/v>/.exec(cuerpo)?.[1] ?? /<t[^>]*>(.*)<\/t>/.exec(cuerpo)?.[1] ?? "";
    }
    filas.push(Array.from(fila, (c) => c ?? ""));
  }
  return filas;
}
