/*
  La plantilla de la alerta diaria (contrato fase 9, prueba 22): asunto, grupos
  por nombre de bodega, tope de renglones, escape y versión de texto.
*/

import { describe, expect, it } from "vitest";
import type { RenglonBajoMinimo } from "../reportes/existencias";
import { asuntoDelResumen, generarResumen, TOPE_RENGLONES, type DatosResumen } from "./plantilla";

const renglon = (bodega: string, i: number, descripcion = `Artículo ${i}`): RenglonBajoMinimo => ({
  bodega, claveArticulo: `ART-${String(i).padStart(5, "0")}`, descripcion, unidad: "PZA", existencia: 1, minimo: 4, faltante: 3,
});

const datos = (cambios: Partial<DatosResumen> = {}): DatosResumen => ({
  fecha: "2026-11-10",
  articulos: 2,
  totalRenglones: 3,
  renglones: [renglon("Bodega Central", 1), renglon("Bodega Central", 2), renglon("Bodega Norte", 1)],
  urlReporte: "https://bodegasosur.prueba.test/reportes/existencias?bajo=1",
  ...cambios,
});

describe("plantilla del resumen diario (prueba 22)", () => {
  it("el asunto lleva N en singular o plural", async () => {
    expect(asuntoDelResumen(1)).toBe("Stock bajo mínimo: 1 artículo");
    expect(asuntoDelResumen(2)).toBe("Stock bajo mínimo: 2 artículos");
    await expect(generarResumen(datos({ articulos: 1, totalRenglones: 1, renglones: [renglon("Bodega Central", 1)] }))).resolves.toMatchObject({
      asunto: "Stock bajo mínimo: 1 artículo",
    });
  });

  it("agrupa por nombre de bodega sin su clave, con clave, existencia, mínimo y faltante de cada artículo", async () => {
    const { html, texto } = await generarResumen(datos());
    expect(html).toContain("Bodega Central");
    expect(html).toContain("Bodega Norte");
    expect(html).not.toContain("BDG-");
    expect(html.indexOf("Bodega Central")).toBeLessThan(html.indexOf("Bodega Norte"));
    expect(html).toContain("ART-00002");
    for (const c of ["Clave", "Descripción", "Unidad", "Existencia", "Mínimo", "Faltante"]) expect(html).toContain(c);
    // Un artículo bajo mínimo en dos bodegas sale en los dos grupos.
    expect(html.split("ART-00001")).toHaveLength(3);
    expect(texto).toContain("Bodega Norte\n- ART-00001 · Artículo 1 (PZA): existencia 1, mínimo 4, faltante 3");
    expect(texto).toContain("2 artículos están por debajo de su mínimo");
  });

  it("respeta el tope: dice cuántos renglones faltan y remite al reporte", async () => {
    const renglones = Array.from({ length: TOPE_RENGLONES }, (_, i) => renglon("Bodega Central", i + 1));
    const largo = await generarResumen(datos({ articulos: 57, totalRenglones: 57, renglones }));
    expect(largo.html).toContain("Y 7 renglones más");
    expect(largo.texto).toContain("Y 7 renglones más");
    expect(largo.html).toContain('href="https://bodegasosur.prueba.test/reportes/existencias?bajo=1"');
    expect(largo.texto).toContain("https://bodegasosur.prueba.test/reportes/existencias?bajo=1");

    const unoMas = await generarResumen(datos({ totalRenglones: 4 }));
    expect(unoMas.html).toContain("Y 1 renglón más");
    const completo = await generarResumen(datos());
    expect(completo.html).not.toContain("más, que puedes ver");
  });

  it("escapa el texto que viene de la base y no lleva enlace para desactivar la alerta", async () => {
    const hostil = `<script>alert("x")</script> & <img src=x onerror=alert(1)>`;
    const { html, texto } = await generarResumen(
      datos({ renglones: [renglon(`<b>Bodega</b>`, 1, hostil)], totalRenglones: 1, articulos: 1 }),
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<b>Bodega</b>");
    expect(html).toContain("&lt;script&gt;");
    expect(texto).toContain(hostil);
    expect(html).toContain("apartado Preferencias");
    expect(html.match(/<a\s/g)).toHaveLength(1);
  });

  it("la versión de texto no rompe la lista con saltos de línea de la base", async () => {
    const { texto } = await generarResumen(datos({ renglones: [renglon("Bodega\nCentral", 1, "Línea uno\n\nlínea dos")], totalRenglones: 1, articulos: 1 }));
    expect(texto).toContain("Bodega Central\n- ART-00001 · Línea uno línea dos (PZA)");
  });
});
