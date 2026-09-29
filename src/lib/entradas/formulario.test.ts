/*
  La frontera del navegador: lo que el esquema deja pasar es exactamente lo
  que el servicio espera, y lo que rechaza no llega a tocar la base.
*/

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hoyEnMexico } from "../fechas";
import {
  erroresDe,
  erroresDeAlta,
  esquemaAlta,
  esquemaBorrador,
  esquemaDescarte,
  leerAlta,
  leerFormulario,
} from "./formulario";

const PROVEEDOR = randomUUID();
const BODEGA = randomUUID();
const ARTICULO = randomUUID();
const OTRO = randomUUID();

function captura(extra: Record<string, unknown> = {}, partidas?: Record<string, unknown>[]) {
  return {
    encabezado: { proveedorId: PROVEEDOR, bodegaDestinoId: BODEGA, fecha: "2026-09-10", moneda: "MXN", referencia: " F-1 ", ...extra },
    partidas: partidas ?? [
      { articuloId: ARTICULO, presentacion: "CAJA", cantidadCapturada: "3", costoUnitarioCapturado: "120", tasaIva: "0.16", numeroSerie: "", observaciones: " golpeada " },
    ],
  };
}

function errores(entrada: unknown) {
  const r = esquemaBorrador.safeParse(entrada);
  return r.success ? {} : erroresDe(r.error);
}

describe("esquemaBorrador", () => {
  it("produce el DatosBorrador que el servicio espera, sin nada derivado", () => {
    const r = esquemaBorrador.parse(captura());
    expect(r).toEqual({
      encabezado: { proveedorId: PROVEEDOR, bodegaDestinoId: BODEGA, fecha: "2026-09-10", moneda: "MXN", tipoCambio: null, referencia: "F-1", observaciones: null },
      partidas: [
        { articuloId: ARTICULO, presentacion: "CAJA", cantidadCapturada: 3, costoUnitarioCapturado: "120", tasaIva: "0.16", numeroSerie: null, observaciones: "golpeada" },
      ],
    });
    expect(Object.keys(r.partidas[0])).not.toContain("factorConversion");
  });

  it("ignora lo derivado aunque el navegador lo mande", () => {
    const r = esquemaBorrador.parse(captura({}, [{ ...captura().partidas[0], factorConversion: 99, cantidad: 1, costoUnitario: "0" }]));
    expect(r.partidas[0]).not.toHaveProperty("factorConversion");
    expect(r.partidas[0]).not.toHaveProperty("costoUnitario");
  });

  it("identificadores y llave: solo UUID", () => {
    expect(errores(captura({ proveedorId: "1 OR 1=1" }))).toMatchObject({ "encabezado.proveedorId": "Identificador inválido" });
    expect(errores(captura({ bodegaDestinoId: "" }))).toMatchObject({ "encabezado.bodegaDestinoId": "No se seleccionó nada" });
    expect(errores(captura({}, [{ ...captura().partidas[0], articuloId: "abc" }]))).toMatchObject({ "partidas.0.articuloId": "Identificador inválido" });
    expect(esquemaAlta.safeParse({ llaveIdempotencia: "no", borrador: captura() }).success).toBe(false);
    expect(esquemaAlta.safeParse({ llaveIdempotencia: randomUUID(), borrador: captura() }).success).toBe(true);
    expect(esquemaDescarte.safeParse({ id: "x", motivo: "y" }).success).toBe(false);
    expect(esquemaDescarte.safeParse({ id: randomUUID(), motivo: "   " }).success).toBe(false);
  });

  it("los UUID se canonizan a minúsculas y el duplicado se detecta aunque venga en mayúsculas", () => {
    const p = captura().partidas[0];
    const r = esquemaBorrador.parse(captura({ proveedorId: PROVEEDOR.toUpperCase() }, [{ ...p, articuloId: ARTICULO.toUpperCase() }]));
    expect(r.encabezado.proveedorId).toBe(PROVEEDOR);
    expect(r.partidas[0].articuloId).toBe(ARTICULO);
    expect(errores(captura({}, [p, { ...p, articuloId: ARTICULO.toUpperCase() }]))).toMatchObject({
      "partidas.1.articuloId": "Este artículo ya está en otra partida",
    });
    expect(esquemaAlta.parse({ llaveIdempotencia: PROVEEDOR.toUpperCase(), borrador: captura() }).llaveIdempotencia).toBe(PROVEEDOR);
  });

  it("cantidades: solo dígitos; ni 1.5 tornillos, ni 0.5 cajas, ni 3.0", () => {
    const p = captura().partidas[0];
    for (const c of ["1.5", "0.5", "3.0", "1e3", "-2", "+2", "abc", "", "1 000", "10000000"]) {
      expect(errores(captura({}, [{ ...p, cantidadCapturada: c }])), c).toHaveProperty("partidas.0.cantidadCapturada");
    }
    expect(esquemaBorrador.parse(captura({}, [{ ...p, cantidadCapturada: " 12 " }])).partidas[0].cantidadCapturada).toBe(12);
  });

  it("fecha: hoy en México sí; futura, anterior al 2000 o inexistente no", () => {
    expect(errores(captura({ fecha: hoyEnMexico() }))).toEqual({});
    expect(errores(captura({ fecha: "2099-01-01" }))).toMatchObject({ "encabezado.fecha": "La fecha no puede ser posterior a hoy" });
    expect(errores(captura({ fecha: "1999-12-31" }))).toMatchObject({ "encabezado.fecha": expect.stringContaining("2000-01-01") });
    expect(errores(captura({ fecha: "2026-02-30" }))).toMatchObject({ "encabezado.fecha": expect.stringContaining("válida") });
    expect(errores(captura({ fecha: "10/09/2026" }))).toMatchObject({ "encabezado.fecha": expect.stringContaining("válida") });
  });

  it("moneda: en USD el tipo de cambio es obligatorio y positivo; en MXN se descarta", () => {
    expect(errores(captura({ moneda: "USD" }))).toMatchObject({ "encabezado.tipoCambio": expect.stringContaining("obligatorio") });
    expect(errores(captura({ moneda: "USD", tipoCambio: "0" }))).toHaveProperty("encabezado.tipoCambio");
    expect(errores(captura({ moneda: "USD", tipoCambio: "-17.5" }))).toHaveProperty("encabezado.tipoCambio");
    expect(errores(captura({ moneda: "USD", tipoCambio: "17.1234567" }))).toHaveProperty("encabezado.tipoCambio");
    expect(esquemaBorrador.parse(captura({ moneda: "USD", tipoCambio: " 17.5 " })).encabezado.tipoCambio).toBe("17.5");
    expect(esquemaBorrador.parse(captura({ moneda: "MXN", tipoCambio: "17.5" })).encabezado.tipoCambio).toBeNull();
    expect(errores(captura({ moneda: "EUR" }))).toHaveProperty("encabezado.moneda");
  });

  it("partidas: cantidad entera positiva, costo decimal sin signo, tasa de la lista, sin artículos repetidos", () => {
    const p = captura().partidas[0];
    expect(errores(captura({}, [{ ...p, cantidadCapturada: "0" }]))).toHaveProperty("partidas.0.cantidadCapturada");
    expect(errores(captura({}, [{ ...p, costoUnitarioCapturado: "-1" }]))).toHaveProperty("partidas.0.costoUnitarioCapturado");
    expect(errores(captura({}, [{ ...p, costoUnitarioCapturado: "1.12345" }]))).toHaveProperty("partidas.0.costoUnitarioCapturado");
    expect(errores(captura({}, [{ ...p, costoUnitarioCapturado: "1e3" }]))).toHaveProperty("partidas.0.costoUnitarioCapturado");
    expect(errores(captura({}, [{ ...p, tasaIva: "0.15" }]))).toHaveProperty("partidas.0.tasaIva");
    expect(errores(captura({}, [{ ...p, presentacion: "PALLET" }]))).toHaveProperty("partidas.0.presentacion");
    expect(errores(captura({}, [p, { ...p, articuloId: OTRO }, { ...p }]))).toMatchObject({ "partidas.2.articuloId": "Este artículo ya está en otra partida" });
    expect(errores(captura({}, []))).toEqual({});
  });

  it("los textos libres se recortan y tienen tope", () => {
    expect(errores(captura({ referencia: "x".repeat(61) }))).toHaveProperty("encabezado.referencia");
    expect(errores(captura({}, [{ ...captura().partidas[0], numeroSerie: "x".repeat(81) }]))).toHaveProperty("partidas.0.numeroSerie");
    expect(esquemaBorrador.parse(captura({ observaciones: "  " })).encabezado.observaciones).toBeNull();
  });
});

describe("leerFormulario", () => {
  function formData(pares: Record<string, string>) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(pares)) fd.append(k, v);
    return fd;
  }

  it("arma encabezado y partidas desde nombres indexados, compactando huecos y en orden", () => {
    const fd = formData({
      "encabezado.proveedorId": PROVEEDOR,
      "encabezado.bodegaDestinoId": BODEGA,
      "encabezado.fecha": "2026-09-10",
      "encabezado.moneda": "MXN",
      "partidas.5.articuloId": OTRO,
      "partidas.5.presentacion": "UNIDAD",
      "partidas.5.cantidadCapturada": "5",
      "partidas.5.costoUnitarioCapturado": "7.5",
      "partidas.5.tasaIva": "0",
      "partidas.2.articuloId": ARTICULO,
      "partidas.2.presentacion": "CAJA",
      "partidas.2.cantidadCapturada": "3",
      "partidas.2.costoUnitarioCapturado": "120",
      "partidas.2.tasaIva": "0.16",
      "ajeno": "se ignora",
      "partidas.x.articuloId": "se ignora",
    });
    const r = esquemaBorrador.parse(leerFormulario(fd));
    expect(r.partidas.map((p) => p.articuloId)).toEqual([ARTICULO, OTRO]);
    expect(r.encabezado.proveedorId).toBe(PROVEEDOR);
  });

  it("FormData → leerAlta → esquemaAlta: la llave oculta y el borrador viajan juntos", () => {
    const llave = randomUUID();
    const fd = formData({
      llaveIdempotencia: llave.toUpperCase(),
      "encabezado.proveedorId": PROVEEDOR,
      "encabezado.bodegaDestinoId": BODEGA,
      "encabezado.fecha": "2026-09-10",
      "encabezado.moneda": "MXN",
      "partidas.0.articuloId": ARTICULO,
      "partidas.0.presentacion": "CAJA",
      "partidas.0.cantidadCapturada": "3",
      "partidas.0.costoUnitarioCapturado": "120",
      "partidas.0.tasaIva": "0.16",
    });
    const r = esquemaAlta.parse(leerAlta(fd));
    expect(r.llaveIdempotencia).toBe(llave);
    expect(r.borrador.partidas).toHaveLength(1);
    expect(r.borrador.encabezado.proveedorId).toBe(PROVEEDOR);

    fd.delete("llaveIdempotencia");
    const sinLlave = esquemaAlta.safeParse(leerAlta(fd));
    expect(sinLlave.success).toBe(false);
    if (!sinLlave.success) expect(erroresDe(sinLlave.error)).toHaveProperty("llaveIdempotencia");
  });

  it("erroresDeAlta usa la ruta del formulario, sin el prefijo del borrador, y deja la llave aparte", () => {
    const fd = formData({
      llaveIdempotencia: "no-soy-uuid",
      "encabezado.proveedorId": PROVEEDOR,
      "encabezado.bodegaDestinoId": BODEGA,
      "encabezado.fecha": "2099-01-01",
      "encabezado.moneda": "MXN",
      "partidas.0.articuloId": ARTICULO,
      "partidas.0.presentacion": "UNIDAD",
      "partidas.0.cantidadCapturada": "1.5",
      "partidas.0.costoUnitarioCapturado": "1",
      "partidas.0.tasaIva": "0.16",
    });
    const r = esquemaAlta.safeParse(leerAlta(fd));
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(Object.keys(erroresDeAlta(r.error)).sort()).toEqual(["encabezado.fecha", "llaveIdempotencia", "partidas.0.cantidadCapturada"]);
  });

  it("erroresDe aplana con ruta y se queda con el primer mensaje por campo", () => {
    const r = esquemaBorrador.safeParse(captura({ proveedorId: "", fecha: "x" }, [{ articuloId: "", cantidadCapturada: "0" }]));
    expect(r.success).toBe(false);
    if (r.success) return;
    const e = erroresDe(r.error);
    expect(Object.keys(e).sort()).toEqual(
      ["encabezado.fecha", "encabezado.proveedorId", "partidas.0.articuloId", "partidas.0.cantidadCapturada", "partidas.0.costoUnitarioCapturado", "partidas.0.presentacion", "partidas.0.tasaIva"].sort(),
    );
  });
});
