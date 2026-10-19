import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setImmediate as cederTurno } from "node:timers/promises";
import { crc32, createDeflateRaw } from "node:zlib";
import { aFechaDeBase, deFechaDeBase, esFechaCalendario, relojDeMexico } from "@/lib/fechas";
import type { Formato, Hoja, Valor } from "./hoja";

/*
  Un libro .xlsx (Office Open XML) escrito a mano: un ZIP con el XML mínimo,
  sin dependencias. Las cadenas van en línea (inlineStr), que Excel nunca
  evalúa como fórmula; además, las que empiezan como una fórmula llevan
  quotePrefix, para que tampoco se evalúen al editarlas. Los números se
  escriben con el texto que dio PostgreSQL, sin pasar por punto flotante.
  Las hojas se escriben y comprimen por partes: el XML completo nunca está en
  memoria, solo el libro comprimido.
*/

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
const NS_R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** Índices de cellXfs en ESTILOS. */
const ESTILO = { normal: 0, negrita: 1, fecha: 2, instante: 3, entero: 4, importe: 5, costo: 6, textoLiteral: 7 } as const;

const ESTILOS = `${XML}<styleSheet ${NS}>
<numFmts count="3"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy hh:mm"/><numFmt numFmtId="166" formatCode="#,##0.0000"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" quotePrefix="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

export class ValorNoExportable extends Error {
  constructor(formato: Formato, valor: unknown) {
    super(`No se puede escribir «${String(valor)}» como ${formato}.`);
    this.name = "ValorNoExportable";
  }
}

// ──────────────────────────────── Celdas ─────────────────────────────────────

/** Caracteres que XML 1.0 no admite: se quitan. */
const INVALIDOS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const MAXIMO_DE_CELDA = 32_767;

const escapar = (texto: string) =>
  texto.replace(INVALIDOS, "").slice(0, MAXIMO_DE_CELDA).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Lo que Excel tomaría por fórmula o por comando: =, +, -, @ y controles al inicio (OWASP, CSV injection). */
export const pareceFormula = (texto: string) => /^[=+\-@\t\r\n\u0000-\u001F]/.test(texto);

const DECIMAL = /^-?\d{1,15}(\.\d{1,10})?$/;
const DIA_CERO = Date.UTC(1899, 11, 30);

/** Días desde el 30/12/1899, la época de las fechas de Excel. */
const serialDeFecha = (texto: string) => (aFechaDeBase(texto).getTime() - DIA_CERO) / 86_400_000;

function celdaDeTexto(ref: string, texto: string, estilo: number = ESTILO.normal): string {
  const s = pareceFormula(texto) ? ESTILO.textoLiteral : estilo;
  const t = escapar(texto);
  const espacio = t !== t.trim() ? ' xml:space="preserve"' : "";
  return `<c r="${ref}" t="inlineStr"${s ? ` s="${s}"` : ""}><is><t${espacio}>${t}</t></is></c>`;
}

const celdaNumerica = (ref: string, numero: string, estilo: number) => `<c r="${ref}" s="${estilo}"><v>${numero}</v></c>`;

function celda(ref: string, formato: Formato, valor: Valor): string {
  if (valor === null || valor === undefined || valor === "") return "";
  switch (formato) {
    case "texto":
      return celdaDeTexto(ref, String(valor));
    case "entero":
    case "importe":
    case "costo": {
      const texto = typeof valor === "number" && Number.isFinite(valor) ? String(valor) : valor;
      if (typeof texto !== "string" || !DECIMAL.test(texto)) throw new ValorNoExportable(formato, valor);
      return celdaNumerica(ref, texto, ESTILO[formato]);
    }
    case "fecha": {
      const dia = valor instanceof Date ? deFechaDeBase(valor) : valor;
      if (typeof dia !== "string" || !esFechaCalendario(dia)) throw new ValorNoExportable(formato, valor);
      return celdaNumerica(ref, String(serialDeFecha(dia)), ESTILO.fecha);
    }
    case "instante": {
      if (!(valor instanceof Date) || Number.isNaN(valor.getTime())) throw new ValorNoExportable(formato, valor);
      // Excel no tiene zona: se escribe la hora que marcaba el reloj de México.
      const { fecha, minuto } = relojDeMexico(valor);
      return celdaNumerica(ref, (serialDeFecha(fecha) + minuto / 1440).toFixed(10).replace(/\.?0+$/, ""), ESTILO.instante);
    }
  }
}

/** A, B, …, Z, AA, AB… */
export function letraDeColumna(n: number): string {
  let letras = "";
  for (let i = n + 1; i > 0; i = Math.floor((i - 1) / 26)) letras = String.fromCharCode(65 + ((i - 1) % 26)) + letras;
  return letras;
}

// ──────────────────────────────── Hojas ──────────────────────────────────────

const ANCHO: Record<Formato, number> = { texto: 18, entero: 12, importe: 15, costo: 15, fecha: 12, instante: 17 };

/** Filas de datos por parte de la hoja. */
const FILAS_POR_PARTE = 100;

/** Título, generación y filtros arriba, una fila en blanco y el encabezado; luego los datos. */
function disposicion(h: Hoja<unknown>) {
  const filtros: [string, string][] = h.filtros.length ? h.filtros : [["Filtros", "Ninguno"]];
  const encabezado = filtros.length + 4;
  const ultima = letraDeColumna(Math.max(h.columnas.length - 1, 0));
  const rango = h.columnas.length ? `$A$${encabezado}:$${ultima}$${encabezado + h.filas.length}` : null;
  return { filtros, encabezado, rango };
}

/** La hoja por partes, con encabezado fijo y autofiltro sobre la tabla. */
function* hojaXml(h: Hoja<unknown>, generadoEn: Date): Generator<string> {
  const { filtros, encabezado, rango } = disposicion(h);
  const fila = (n: number, celdas: string[]) => `<row r="${n}">${celdas.join("")}</row>`;
  const arriba = [
    fila(1, [celdaDeTexto("A1", h.titulo, ESTILO.negrita)]),
    fila(2, [celdaDeTexto("A2", "Generado"), celda("B2", "instante", generadoEn)]),
    ...filtros.map(([etiqueta, valor], i) => fila(i + 3, [celdaDeTexto(`A${i + 3}`, etiqueta), celdaDeTexto(`B${i + 3}`, valor)])),
    `<row r="${encabezado - 1}"/>`,
    fila(encabezado, h.columnas.map((c, i) => celdaDeTexto(`${letraDeColumna(i)}${encabezado}`, c.titulo, ESTILO.negrita))),
  ];
  const columnas = h.columnas.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(ANCHO[c.formato], Math.min(c.titulo.length + 2, 40))}" customWidth="1"/>`);
  yield `${XML}<worksheet ${NS} ${NS_R}>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="${encabezado}" topLeftCell="A${encabezado + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
${columnas.length ? `<cols>${columnas.join("")}</cols>` : ""}<sheetData>${arriba.join("")}`;

  const letras = h.columnas.map((_, i) => letraDeColumna(i));
  let parte: string[] = [];
  for (const [i, f] of h.filas.entries()) {
    const n = encabezado + 1 + i;
    parte.push(fila(n, h.columnas.map((c, j) => celda(`${letras[j]}${n}`, c.formato, c.valor(f)))));
    if (parte.length === FILAS_POR_PARTE) {
      yield parte.join("");
      parte = [];
    }
  }
  yield `${parte.join("")}</sheetData>${rango ? `<autoFilter ref="${rango.replace(/\$/g, "")}"/>` : ""}
</worksheet>`;
}

/** Lo que Excel acepta como nombre de pestaña: sin []:*?/\, hasta 31 caracteres y sin repetirse. */
function nombresDePestana(hojas: Hoja<unknown>[]): string[] {
  const usados = new Set<string>();
  return hojas.map((h, i) => {
    const base = h.nombre.replace(/[[\]:*?/\\']/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || `Hoja ${i + 1}`;
    let nombre = base;
    for (let n = 2; usados.has(nombre.toLowerCase()); n++) nombre = `${base.slice(0, 31 - ` (${n})`.length)} (${n})`;
    usados.add(nombre.toLowerCase());
    return nombre;
  });
}

/** El libro completo: se arma por partes y se entrega solo si sale entero. */
export async function libroXlsx(hojas: Hoja<unknown>[], generadoEn: Date, titulo: string): Promise<Buffer> {
  if (hojas.length === 0) throw new Error("Un libro necesita al menos una hoja.");
  const nombres = nombresDePestana(hojas);
  const definidos = hojas.flatMap((h, i) => {
    const { rango } = disposicion(h);
    return rango ? [`<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${escapar(nombres[i])}'!${rango}</definedName>`] : [];
  });

  const archivos: [string, Iterable<string>][] = [
    [
      "[Content_Types].xml",
      [
        `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
${nombres.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("\n")}
</Types>`,
      ],
    ],
    [
      "_rels/.rels",
      [
        `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`,
      ],
    ],
    [
      "docProps/core.xml",
      [
        `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${escapar(titulo)}</dc:title><dc:creator>BodeGasosur</dc:creator>
<dcterms:created xsi:type="dcterms:W3CDTF">${generadoEn.toISOString().replace(/\.\d{3}Z$/, "Z")}</dcterms:created>
</cp:coreProperties>`,
      ],
    ],
    [
      "xl/workbook.xml",
      [
        `${XML}<workbook ${NS} ${NS_R}><sheets>${nombres
          .map((n, i) => `<sheet name="${escapar(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
          .join("")}</sheets>${definidos.length ? `<definedNames>${definidos.join("")}</definedNames>` : ""}</workbook>`,
      ],
    ],
    [
      "xl/_rels/workbook.xml.rels",
      [
        `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${nombres.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("\n")}
<Relationship Id="rId${nombres.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
      ],
    ],
    ["xl/styles.xml", [ESTILOS]],
    ...hojas.map((h, i): [string, Iterable<string>] => [`xl/worksheets/sheet${i + 1}.xml`, hojaXml(h, generadoEn)]),
  ];

  const libro = zipEnMemoria();
  for (const [nombre, contenido] of archivos) await libro.agregar(nombre, contenido);
  return libro.cerrar();
}

// ───────────────────────────────── ZIP ───────────────────────────────────────

/**
 * Un ZIP comprimido con deflate, en memoria. Cada archivo se comprime parte por
 * parte, cediendo el event loop entre una y otra, y su encabezado local se
 * escribe al terminarlo, ya con su CRC y tamaños. Sin ZIP64: un libro de este
 * sistema no se acerca a 4 GB.
 */
function zipEnMemoria() {
  const partes: Buffer[] = [];
  const central: Buffer[] = [];
  let desplazamiento = 0;
  // Fecha fija de MS-DOS (1/1/1980): la del libro va en docProps/core.xml.
  const [hora, fecha] = [0, 0x21];

  return {
    async agregar(nombre: string, contenido: Iterable<string>) {
      let crc = 0;
      let largo = 0;
      const comprimido: Buffer[] = [];
      async function* bytes() {
        for (const texto of contenido) {
          const datos = Buffer.from(texto, "utf8");
          crc = crc32(datos, crc);
          largo += datos.length;
          yield datos;
          await cederTurno();
        }
      }
      await pipeline(Readable.from(bytes()), createDeflateRaw(), async (salida: AsyncIterable<Buffer>) => {
        for await (const trozo of salida) comprimido.push(trozo);
      });
      const tamano = comprimido.reduce((n, b) => n + b.length, 0);
      const n = Buffer.from(nombre, "utf8");

      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(0x0800, 6);
      local.writeUInt16LE(8, 8);
      local.writeUInt16LE(hora, 10);
      local.writeUInt16LE(fecha, 12);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(tamano, 18);
      local.writeUInt32LE(largo, 22);
      local.writeUInt16LE(n.length, 26);
      local.writeUInt16LE(0, 28);

      const entrada = Buffer.alloc(46);
      entrada.writeUInt32LE(0x02014b50, 0);
      entrada.writeUInt16LE(20, 4);
      entrada.writeUInt16LE(20, 6);
      entrada.writeUInt16LE(0x0800, 8);
      entrada.writeUInt16LE(8, 10);
      entrada.writeUInt16LE(hora, 12);
      entrada.writeUInt16LE(fecha, 14);
      entrada.writeUInt32LE(crc, 16);
      entrada.writeUInt32LE(tamano, 20);
      entrada.writeUInt32LE(largo, 24);
      entrada.writeUInt16LE(n.length, 28);
      entrada.writeUInt32LE(desplazamiento, 42);

      partes.push(local, n, ...comprimido);
      central.push(entrada, n);
      desplazamiento += local.length + n.length + tamano;
    },

    cerrar(): Buffer {
      const directorio = Buffer.concat(central);
      const archivos = central.length / 2;
      const fin = Buffer.alloc(22);
      fin.writeUInt32LE(0x06054b50, 0);
      fin.writeUInt16LE(archivos, 8);
      fin.writeUInt16LE(archivos, 10);
      fin.writeUInt32LE(directorio.length, 12);
      fin.writeUInt32LE(desplazamiento, 16);
      return Buffer.concat([...partes, directorio, fin]);
    },
  };
}
