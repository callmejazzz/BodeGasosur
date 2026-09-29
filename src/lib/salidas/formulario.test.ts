/*
  La frontera del navegador: lo que el esquema deja pasar es lo que el
  servicio espera, y lo que el servidor deriva o toma de la sesión no pasa.
*/

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { erroresDe } from "../movimientos/formulario";
import {
  erroresDeAlta,
  esquemaAlta,
  esquemaCancelacion,
  esquemaRechazo,
  esquemaRetiro,
  esquemaSolicitud,
  leerAlta,
} from "./formulario";

const BODEGA = randomUUID();
const ESTACION = randomUUID();
const ARTICULO = randomUUID();

function captura(encabezado: Record<string, unknown> = {}, partidas?: Record<string, unknown>[]) {
  return {
    encabezado: { bodegaOrigenId: BODEGA, estacionId: ESTACION, ...encabezado },
    partidas: partidas ?? [{ articuloId: ARTICULO, presentacion: "CAJA", cantidadCapturada: " 2 ", observaciones: " urgente " }],
  };
}

function errores(entrada: unknown) {
  const r = esquemaSolicitud.safeParse(entrada);
  return r.success ? {} : erroresDe(r.error);
}

describe("esquemaSolicitud", () => {
  it("produce la DatosSolicitud que el servicio espera", () => {
    expect(esquemaSolicitud.parse(captura({ solicitadoPorId: "", areaId: "", esPrestamo: "on", observaciones: " " }))).toEqual({
      encabezado: { bodegaOrigenId: BODEGA, estacionId: ESTACION, solicitadoPorId: null, areaId: null, esPrestamo: true, observaciones: null },
      partidas: [{ articuloId: ARTICULO, presentacion: "CAJA", cantidadCapturada: 2, observaciones: "urgente" }],
    });
  });

  it("descarta lo que el servidor deriva o toma de la sesión", () => {
    const r = esquemaSolicitud.parse(
      captura({ creadoPorId: randomUUID(), estatus: "AUTORIZADA", folio: "S-000001" }, [
        { articuloId: ARTICULO, presentacion: "UNIDAD", cantidadCapturada: "1", factorConversion: "99", cantidad: "99", costoUnitario: "1" },
      ]),
    );
    expect(Object.keys(r.encabezado).sort()).toEqual(["areaId", "bodegaOrigenId", "esPrestamo", "estacionId", "observaciones", "solicitadoPorId"]);
    expect(Object.keys(r.partidas[0]).sort()).toEqual(["articuloId", "cantidadCapturada", "observaciones", "presentacion"]);
  });

  it("normaliza los UUID a minúsculas y rechaza lo que no lo es", () => {
    const r = esquemaSolicitud.parse(captura({ estacionId: ESTACION.toUpperCase(), areaId: ` ${BODEGA.toUpperCase()} ` }));
    expect(r.encabezado).toMatchObject({ estacionId: ESTACION, areaId: BODEGA });
    expect(errores(captura({ bodegaOrigenId: "1 OR 1=1" }))).toHaveProperty(["encabezado.bodegaOrigenId"]);
    expect(errores(captura({ areaId: "no-soy-uuid" }))).toHaveProperty(["encabezado.areaId"]);
  });

  it("cantidades enteras escritas como dígitos, presentación válida, al menos una partida y sin repetir artículo", () => {
    for (const cantidad of ["1.5", "3.0", "1e3", "-2", "0", "", "10000000"]) {
      expect(errores(captura({}, [{ articuloId: ARTICULO, presentacion: "UNIDAD", cantidadCapturada: cantidad }])), cantidad).toHaveProperty([
        "partidas.0.cantidadCapturada",
      ]);
    }
    expect(errores(captura({}, [{ articuloId: ARTICULO, presentacion: "PAQUETE", cantidadCapturada: "1" }]))).toHaveProperty(["partidas.0.presentacion"]);
    expect(errores(captura({}, []))).toHaveProperty(["partidas"]);
    const p = { articuloId: ARTICULO, presentacion: "UNIDAD", cantidadCapturada: "1" };
    expect(errores(captura({}, [p, p]))).toHaveProperty(["partidas.1.articuloId"]);
  });

  it("cada error dice qué corregir: un select vacío, la cantidad que falta o sobra", () => {
    const cantidad = (c: string) => errores(captura({}, [{ articuloId: ARTICULO, presentacion: "UNIDAD", cantidadCapturada: c }]))["partidas.0.cantidadCapturada"];
    expect(errores(captura({ bodegaOrigenId: "", estacionId: undefined }, [{ articuloId: " ", presentacion: "UNIDAD", cantidadCapturada: "1" }]))).toMatchObject({
      "encabezado.bodegaOrigenId": "No se seleccionó nada",
      "encabezado.estacionId": "No se seleccionó nada",
      "partidas.0.articuloId": "No se seleccionó nada",
    });
    expect(errores(captura({ bodegaOrigenId: "1 OR 1=1" }))).toMatchObject({ "encabezado.bodegaOrigenId": "Identificador inválido" });
    expect(cantidad(" ")).toBe("Indica la cantidad");
    expect(cantidad("1.5")).toBe("Solo cantidades enteras, sin decimales");
    expect(cantidad("99999999")).toBe("Cantidad demasiado grande");
    expect(cantidad("9".repeat(400))).toBe("Cantidad demasiado grande");
    expect(cantidad("0")).toBe("La cantidad debe ser mayor que cero");
  });

  it("préstamo solo es verdadero si la casilla viene marcada", () => {
    for (const [valor, esperado] of [[undefined, false], ["", false], ["false", false], ["on", true], ["true", true], [true, true]] as const) {
      expect(esquemaSolicitud.parse(captura({ esPrestamo: valor })).encabezado.esPrestamo, String(valor)).toBe(esperado);
    }
    expect(errores(captura({ esPrestamo: "tal vez" }))).toHaveProperty(["encabezado.esPrestamo"]);
  });
});

describe("del FormData al alta", () => {
  it("lee la llave, el encabezado y las partidas en orden", () => {
    const llave = randomUUID();
    const fd = new FormData();
    fd.set("llaveIdempotencia", llave);
    fd.set("encabezado.bodegaOrigenId", BODEGA);
    fd.set("encabezado.estacionId", ESTACION);
    fd.set("encabezado.esPrestamo", "on");
    fd.set("partidas.1.articuloId", randomUUID());
    fd.set("partidas.1.presentacion", "UNIDAD");
    fd.set("partidas.1.cantidadCapturada", "4");
    fd.set("partidas.0.articuloId", ARTICULO);
    fd.set("partidas.0.presentacion", "CAJA");
    fd.set("partidas.0.cantidadCapturada", "1");
    fd.set("creadoPorId", randomUUID());
    const r = esquemaAlta.parse(leerAlta(fd));
    expect(r.llaveIdempotencia).toBe(llave);
    expect(r.solicitud.encabezado.esPrestamo).toBe(true);
    expect(r.solicitud.partidas.map((p) => p.cantidadCapturada)).toEqual([1, 4]);
  });

  it("sin llave válida no hay alta", () => {
    const fd = new FormData();
    fd.set("encabezado.bodegaOrigenId", BODEGA);
    expect(esquemaAlta.safeParse(leerAlta(fd)).success).toBe(false);
  });
});

describe("transiciones", () => {
  it("motivo y quién se lleva el material: obligatorios, recortados y acotados", () => {
    const id = randomUUID();
    expect(esquemaRechazo.parse({ id, motivo: "  Sin presupuesto " })).toEqual({ id, motivo: "Sin presupuesto" });
    expect(esquemaCancelacion.safeParse({ id, motivo: "   " }).success).toBe(false);
    expect(esquemaRechazo.safeParse({ id, motivo: "x".repeat(301) }).success).toBe(false);
    expect(esquemaRetiro.parse({ id, entregadoA: " Juan " })).toEqual({ id, entregadoA: "Juan" });
    expect(esquemaRetiro.safeParse({ id, entregadoA: "" }).success).toBe(false);
    expect(esquemaRetiro.safeParse({ id, entregadoA: "x".repeat(121) }).success).toBe(false);
    expect(esquemaRetiro.safeParse({ id: "S-000001", entregadoA: "Juan" }).success).toBe(false);
  });
});

describe("errores del alta", () => {
  it("usan la ruta del formulario, sin el prefijo de la solicitud", () => {
    const fd = new FormData();
    fd.set("llaveIdempotencia", "no");
    fd.set("encabezado.bodegaOrigenId", BODEGA);
    fd.set("encabezado.estacionId", "x");
    fd.set("partidas.0.articuloId", ARTICULO);
    fd.set("partidas.0.presentacion", "UNIDAD");
    fd.set("partidas.0.cantidadCapturada", "0");
    const r = esquemaAlta.safeParse(leerAlta(fd));
    expect(r.success).toBe(false);
    expect(Object.keys(erroresDeAlta(r.error!)).sort()).toEqual(["encabezado.estacionId", "llaveIdempotencia", "partidas.0.cantidadCapturada"]);
  });
});
