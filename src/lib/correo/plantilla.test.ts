/*
  La plantilla de la alerta diaria (contrato fase 9, prueba 22): asunto, N,
  una sola tabla con la bodega en su columna, recorte, escape y versión de texto.
*/

import { describe, expect, it } from "vitest";
import type { RenglonBajoMinimo } from "../reportes/existencias";
import { ASUNTO, generarResumen, LARGO_DESCRIPCION, recortarDescripcion, type DatosResumen } from "./plantilla";

const renglon = (bodega: string, i: number, descripcion = `Artículo ${i}`): RenglonBajoMinimo => ({
  bodega, claveArticulo: `ART-${String(i).padStart(5, "0")}`, descripcion, unidad: "PZA", existencia: 1, minimo: 4,
});

const datos = (cambios: Partial<DatosResumen> = {}): DatosResumen => ({
  articulos: 2,
  renglones: [renglon("Bodega Central", 1), renglon("Bodega Central", 2), renglon("Bodega Norte", 1)],
  urlReporte: "https://bodegasosur.prueba.test/reportes/existencias?bajo=1",
  ...cambios,
});

describe("plantilla del resumen diario (prueba 22)", () => {
  it("el asunto es fijo y el cuerpo dice N en singular o plural, sin fecha", async () => {
    const uno = await generarResumen(datos({ articulos: 1, renglones: [renglon("Bodega Central", 1)] }));
    expect(uno.asunto).toBe("Tienes artículos con existencia debajo del mínimo");
    expect(uno.html).toContain("Existencia actual de los artículos");
    expect(uno.html).toContain("Hay 1 artículo por debajo del mínimo");
    const varios = await generarResumen(datos({ articulos: 1234 }));
    expect(varios.asunto).toBe(ASUNTO);
    expect(varios.texto).toContain("Hay 1,234 artículos por debajo del mínimo");
    expect(varios.html).not.toMatch(/\b2026\b|noviembre/);
  });

  it("una sola tabla con clave, descripción, bodega y existencia de M, sin la clave de bodega", async () => {
    const { html, texto } = await generarResumen(datos());
    expect(html.match(/<table[^>]*border-collapse/g)).toHaveLength(1);
    for (const c of ["CLAVE", "DESCRIPCIÓN", "BODEGA", "EXISTENCIA"]) expect(html).toContain(c);
    for (const c of ["Unidad", "Mínimo", "Faltante"]) expect(html).not.toContain(c);
    expect(html).not.toContain("<h2");
    expect(html).not.toContain("BDG-");
    expect(html).toContain("1 de 4 PZA");
    // Un artículo bajo mínimo en dos bodegas sale en dos renglones, cada uno con su bodega.
    expect(html.split("ART-00001")).toHaveLength(3);
    expect(texto).toContain("- ART-00001 · Artículo 1 · Bodega Norte: 1 de 4 PZA");
  });

  it("solo remite al reporte, sin contar los renglones que faltan", async () => {
    const { html, texto } = await generarResumen(datos({ articulos: 57 }));
    expect(html).not.toContain("renglones más");
    expect(html).toContain('href="https://bodegasosur.prueba.test/reportes/existencias?bajo=1"');
    expect(html).toContain("Ver el reporte completo de existencias");
    expect(texto).toContain("Ver el reporte completo de existencias: https://bodegasosur.prueba.test/reportes/existencias?bajo=1");
  });

  it("recorta la descripción larga en el HTML y la deja completa en el texto", async () => {
    const larga = "VÁLVULA DE CORTE RECONECTABLE PARA MANGUERA DE DISPENSARIO DE GASOLINA CON EMPAQUES Y TORNILLERÍA";
    const { html, texto } = await generarResumen(datos({ renglones: [renglon("Bodega Central", 1, larga)], articulos: 1 }));
    expect(html).toContain(recortarDescripcion(larga));
    expect(html).not.toContain(larga);
    expect(texto).toContain(larga);

    expect(recortarDescripcion("Corta  con\nespacios")).toBe("Corta con espacios");
    expect(recortarDescripcion("x".repeat(LARGO_DESCRIPCION))).toBe("x".repeat(LARGO_DESCRIPCION));
    const recortada = recortarDescripcion(larga);
    expect(recortada.length).toBeLessThanOrEqual(LARGO_DESCRIPCION);
    expect(recortada).toMatch(/[^ ]…$/);
    expect(larga.startsWith(recortada.slice(0, -1))).toBe(true);
  });

  it("escapa el texto que viene de la base y no lleva enlace para desactivar la alerta", async () => {
    const hostil = `<script>alert("x")</script> & <img src=x onerror=alert(1)>`;
    const { html, texto } = await generarResumen(datos({ renglones: [renglon(`<b>Bodega</b>`, 1, hostil)], articulos: 1 }));
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<b>Bodega</b>");
    expect(html).toContain("&lt;script&gt;");
    expect(texto).toContain(hostil);
    expect(html).toContain("Puedes desactivar estas notificaciones desde el apartado Preferencias de tu perfil en BodeGasosur");
    expect(html.match(/<a\s/g)).toHaveLength(1);
  });

  it("la versión de texto no rompe la lista con saltos de línea de la base", async () => {
    const { texto } = await generarResumen(datos({ renglones: [renglon("Bodega\nCentral", 1, "Línea uno\n\nlínea dos")], articulos: 1 }));
    expect(texto).toContain("- ART-00001 · Línea uno línea dos · Bodega Central: 1 de 4 PZA");
  });
});
