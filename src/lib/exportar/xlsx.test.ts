/*
  El libro .xlsx se abre como ZIP y se lee su XML: números como número, fechas
  como serial de Excel, texto en línea y lo que parece fórmula, marcado como
  texto literal.
*/

import { describe, expect, it } from "vitest";
import { leerZip } from "../../../pruebas/leer-xlsx";
import { hoja, type Columna } from "./hoja";
import { letraDeColumna, libroXlsx, pareceFormula, ValorNoExportable } from "./xlsx";

type Fila = { folio: string; fecha: string; cantidad: number; importe: string | null; nota: string };
const COLUMNAS: Columna<Fila>[] = [
  { titulo: "Folio", formato: "texto", valor: (f) => f.folio },
  { titulo: "Fecha", formato: "fecha", valor: (f) => f.fecha },
  { titulo: "Cantidad", formato: "entero", valor: (f) => f.cantidad },
  { titulo: "Importe", formato: "importe", valor: (f) => f.importe },
  { titulo: "Nota", formato: "texto", valor: (f) => f.nota },
];

const generado = new Date("2026-10-15T18:30:00Z"); // 12:30 en la Ciudad de México

const libro = await libroXlsx(
  [
    hoja({
      nombre: "Movimientos [1/2]",
      titulo: "Prueba",
      filtros: [["Búsqueda", "tornillo"]],
      columnas: COLUMNAS,
      filas: [
        { folio: "E-000001", fecha: "2026-10-09", cantidad: -3, importe: "-30.00", nota: '=HYPERLINK("http://x","clic")' },
        { folio: "E-000002", fecha: "1900-03-01", cantidad: 1234567, importe: null, nota: "Tornillos <M8> & tuercas\u0007" },
        { folio: "+52 744", fecha: "2026-10-09", cantidad: 0, importe: "0.10", nota: "@SUMA(A1)" },
      ],
    }),
    hoja({ nombre: "Movimientos [1/2]", titulo: "Vacía", filtros: [], columnas: COLUMNAS, filas: [] }),
  ],
  generado,
  "Prueba",
);

describe("libro xlsx", () => {
  const archivos = leerZip(libro);
  const hoja1 = archivos["xl/worksheets/sheet1.xml"];

  it("es un paquete con libro, estilos, propiedades y una hoja por tabla, con pestañas válidas y únicas", () => {
    expect(Object.keys(archivos).sort()).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "docProps/core.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/workbook.xml",
      "xl/worksheets/sheet1.xml",
      "xl/worksheets/sheet2.xml",
    ]);
    expect(archivos["xl/workbook.xml"]).toContain('<sheet name="Movimientos 1 2" sheetId="1" r:id="rId1"/>');
    expect(archivos["xl/workbook.xml"]).toContain('<sheet name="Movimientos 1 2 (2)" sheetId="2" r:id="rId2"/>');
  });

  it("encabeza con título, momento de generación y filtros; sin filtros lo dice", () => {
    expect(hoja1).toMatch(/<row r="1"><c r="A1" t="inlineStr" s="1"><is><t>Prueba<\/t><\/is><\/c><\/row>/);
    // 15/10/2026 12:30 en México = 46310 + 12.5/24.
    expect(hoja1).toContain('<c r="B2" s="3"><v>46310.5208333333</v></c>');
    expect(hoja1).toContain("<t>Búsqueda</t>");
    expect(archivos["xl/worksheets/sheet2.xml"]).toContain("<t>Ninguno</t>");
  });

  it("los números van como número con el texto exacto de la base, y la fecha como serial", () => {
    expect(hoja1).toContain('<c r="C6" s="4"><v>-3</v></c>');
    expect(hoja1).toContain('<c r="D6" s="5"><v>-30.00</v></c>');
    expect(hoja1).toContain('<c r="B6" s="2"><v>46304</v></c>');
    expect(hoja1).toContain('<c r="B7" s="2"><v>61</v></c>');
    expect(hoja1).toContain('<c r="C7" s="4"><v>1234567</v></c>');
    expect(hoja1).not.toContain('r="D7"');
  });

  it("el texto se escapa y lo que parece fórmula queda como texto literal, sin perder el valor", () => {
    expect(hoja1).toContain('<c r="E6" t="inlineStr" s="7"><is><t>=HYPERLINK(&quot;http://x&quot;,&quot;clic&quot;)</t></is></c>');
    expect(hoja1).toContain("<t>Tornillos &lt;M8&gt; &amp; tuercas</t>");
    expect(hoja1).toContain('<c r="A8" t="inlineStr" s="7"><is><t>+52 744</t></is></c>');
    expect(hoja1).toContain('<c r="E8" t="inlineStr" s="7"><is><t>@SUMA(A1)</t></is></c>');
    expect(hoja1).not.toMatch(/<f>/);
    for (const texto of ["=1+1", "+1", "-1", "@A1", "\tx", "\rx"]) expect(pareceFormula(texto), texto).toBe(true);
    for (const texto of ["E-000001", "1-2", "Tornillo"]) expect(pareceFormula(texto), texto).toBe(false);
  });

  it("encabezado fijo y autofiltro sobre la tabla", () => {
    expect(hoja1).toContain('<pane ySplit="5" topLeftCell="A6" activePane="bottomLeft" state="frozen"/>');
    expect(hoja1).toContain('<autoFilter ref="A5:E8"/>');
    expect(archivos["xl/workbook.xml"]).toContain("'Movimientos 1 2'!$A$5:$E$8");
  });

  it("un valor que no es número, fecha o instante no se escribe a medias", async () => {
    const mal = (formato: Columna<null>["formato"], valor: unknown) =>
      libroXlsx([hoja({ nombre: "x", titulo: "x", filtros: [], columnas: [{ titulo: "x", formato, valor: () => valor as never }], filas: [null] })], generado, "x");
    await expect(mal("importe", "1e5")).rejects.toThrow(ValorNoExportable);
    await expect(mal("entero", "12,5")).rejects.toThrow(ValorNoExportable);
    await expect(mal("fecha", "2026-02-30")).rejects.toThrow(ValorNoExportable);
    await expect(mal("instante", "2026-10-15")).rejects.toThrow(ValorNoExportable);
    // El mensaje llega al registro del servidor: conserva el formato, no el valor.
    const rechazo = await mal("costo", "SECRETO-4471").catch((e: unknown) => e);
    expect(rechazo).toMatchObject({ name: "ValorNoExportable", formato: "costo", message: "Una celda no se puede escribir como costo." });
    expect(String((rechazo as Error).stack)).not.toContain("SECRETO-4471");
  });

  it("una hoja grande se escribe por partes, cediendo el event loop, y sale igual que entera", async () => {
    const filas = Array.from({ length: 2_345 }, (_, i): Fila => ({ folio: `E-${i}`, fecha: "2026-10-09", cantidad: i, importe: `${i}.25`, nota: "ñ" }));
    let vueltas = 0;
    let girando = true;
    const girar = () => {
      vueltas++;
      if (girando) setImmediate(girar);
    };
    setImmediate(girar);
    const grande = leerZip(await libroXlsx([hoja({ nombre: "G", titulo: "G", filtros: [], columnas: COLUMNAS, filas })], generado, "G"));
    girando = false;
    // Veinticuatro partes de filas: el event loop corrió entre ellas.
    expect(vueltas).toBeGreaterThanOrEqual(5);
    const xml = grande["xl/worksheets/sheet1.xml"];
    expect(xml.match(/<row /g)).toHaveLength(5 + 2_345);
    expect(xml).toContain('<row r="2350"><c r="A2350" t="inlineStr"><is><t>E-2344</t></is></c>');
    expect(xml).toMatch(/<\/sheetData><autoFilter ref="A5:E2350"\/>\n<\/worksheet>$/);
  });

  it("al abortarse la señal deja de armar y comprimir el libro entre partes", async () => {
    let llamadas = 0;
    const columnas: Columna<number>[] = [{ titulo: "n", formato: "entero", valor: (n) => (llamadas++, n) }];
    const libroDe = (señal: AbortSignal) => libroXlsx([hoja({ nombre: "x", titulo: "x", filtros: [], columnas, filas: Array.from({ length: 20_000 }, (_, i) => i) })], generado, "x", señal);
    const control = new AbortController();
    const promesa = libroDe(control.signal);
    while (llamadas === 0) await new Promise<void>((listo) => setImmediate(listo));
    control.abort(new Error("vencido"));
    await expect(promesa).rejects.toThrow();
    expect(llamadas).toBeLessThan(20_000);
    // Con la señal ya abortada no arma nada.
    llamadas = 0;
    const antes = new AbortController();
    antes.abort(new Error("antes"));
    await expect(libroDe(antes.signal)).rejects.toThrow("antes");
    expect(llamadas).toBe(0);
  });

  it("un valor inválido después de varias partes rechaza el libro entero", async () => {
    const filas = Array.from({ length: 1_200 }, (_, i): Fila => ({ folio: "x", fecha: "2026-10-09", cantidad: i, importe: i === 1_100 ? "1e5" : "1.00", nota: "" }));
    await expect(libroXlsx([hoja({ nombre: "x", titulo: "x", filtros: [], columnas: COLUMNAS, filas })], generado, "x")).rejects.toThrow(ValorNoExportable);
  });

  it("nombra columnas como Excel", () => {
    expect([0, 25, 26, 27, 51, 52, 701, 702].map(letraDeColumna)).toEqual(["A", "Z", "AA", "AB", "AZ", "BA", "ZZ", "AAA"]);
  });
});
