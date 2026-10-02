import { afterEach, describe, expect, it } from "vitest";
import {
  FECHA_MINIMA_OPERATIVA,
  FechaInvalida,
  aFechaDeBase,
  deFechaDeBase,
  diaSiguiente,
  esFechaCalendario,
  esFechaOperativa,
  formatearFecha,
  formatearInstante,
  hoyEnMexico,
  inicioDelDiaEnMexico,
  leerRangoDeFechas,
  motivoFechaNoOperativa,
} from "./fechas";

const ZONAS_DE_PROCESO = ["UTC", "Asia/Tokyo", "America/Mexico_City"] as const;

const zonaOriginal = process.env.TZ;
afterEach(() => {
  if (zonaOriginal === undefined) delete process.env.TZ;
  else process.env.TZ = zonaOriginal;
});

/* Corre el mismo bloque con el proceso en cada zona. */
function enCadaZona(prueba: () => void) {
  for (const zona of ZONAS_DE_PROCESO) {
    process.env.TZ = zona;
    prueba();
  }
}

const instante = (iso: string) => new Date(iso);

describe("hoyEnMexico", () => {
  it("cambia de día a las 06:00 UTC, no a medianoche UTC", () => {
    enCadaZona(() => {
      expect(hoyEnMexico(instante("2026-09-14T05:59:59.999Z"))).toBe("2026-09-13");
      expect(hoyEnMexico(instante("2026-09-14T06:00:00.000Z"))).toBe("2026-09-14");
    });
  });

  it("un movimiento capturado a las 18:30 en Acapulco es de hoy, no de mañana", () => {
    enCadaZona(() => {
      expect(hoyEnMexico(instante("2026-09-15T00:30:00.000Z"))).toBe("2026-09-14");
    });
  });

  it("cruza el mes y el año en la hora de México, no en la del servidor", () => {
    enCadaZona(() => {
      expect(hoyEnMexico(instante("2026-10-01T03:00:00.000Z"))).toBe("2026-09-30");
      expect(hoyEnMexico(instante("2027-01-01T05:59:59.000Z"))).toBe("2026-12-31");
      expect(hoyEnMexico(instante("2027-01-01T06:00:00.000Z"))).toBe("2027-01-01");
    });
  });

  it("devuelve siempre AAAA-MM-DD con ceros a la izquierda", () => {
    expect(hoyEnMexico(instante("2026-03-05T12:00:00.000Z"))).toBe("2026-03-05");
    expect(hoyEnMexico()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("esFechaCalendario", () => {
  it("acepta días reales, incluido el 29 de febrero bisiesto", () => {
    for (const texto of ["2026-09-14", "2024-02-29", "2000-02-29", "2026-12-31", "2026-01-01"]) {
      expect(esFechaCalendario(texto), texto).toBe(true);
    }
  });

  it("rechaza días que no existen en el calendario", () => {
    for (const texto of [
      "2023-02-29", // no bisiesto
      "1900-02-29", // divisible entre 100 pero no entre 400: tampoco
      "2026-04-31",
      "2026-02-30",
      "2026-13-01",
      "2026-00-10",
      "2026-09-00",
      "2026-09-32",
    ]) {
      expect(esFechaCalendario(texto), texto).toBe(false);
    }
  });

  it("rechaza cualquier forma que no sea exactamente AAAA-MM-DD", () => {
    for (const texto of [
      "2026-9-1",
      "14/09/2026",
      "2026/09/14",
      "2026-09-14T00:00:00Z",
      "2026-09-14 ",
      " 2026-09-14",
      "20260914",
      "",
      "hoy",
    ]) {
      expect(esFechaCalendario(texto), texto).toBe(false);
    }
  });

  it("rechaza lo que no es texto", () => {
    for (const valor of [null, undefined, 20260914, new Date("2026-09-14"), {}, []]) {
      expect(esFechaCalendario(valor)).toBe(false);
    }
  });
});

describe("fecha operativa: mínima ≤ fecha ≤ hoy en México", () => {
  // Las 18:30 del 14 en Acapulco: en UTC ya es 15. «Hoy» tiene que ser el 14.
  const ahora = instante("2026-09-15T00:30:00.000Z");
  const hoy = hoyEnMexico(ahora);

  it("la fecha mínima permitida entra", () => {
    expect(FECHA_MINIMA_OPERATIVA).toBe("2000-01-01");
    expect(motivoFechaNoOperativa("2000-01-01", hoy)).toBeNull();
  });

  it("un día antes de la mínima no", () => {
    expect(motivoFechaNoOperativa("1999-12-31", hoy)).toBe("anterior-a-minima");
  });

  it("hoy en México entra aunque en UTC ya sea mañana", () => {
    enCadaZona(() => {
      expect(hoyEnMexico(ahora)).toBe("2026-09-14");
      expect(motivoFechaNoOperativa("2026-09-14", hoyEnMexico(ahora))).toBeNull();
    });
  });

  it("una fecha futura no, ni siquiera el «hoy» del servidor en UTC", () => {
    enCadaZona(() => {
      expect(motivoFechaNoOperativa("2026-09-15", hoyEnMexico(ahora))).toBe("futura");
      expect(motivoFechaNoOperativa("2030-01-01", hoyEnMexico(ahora))).toBe("futura");
    });
  });

  it("una fecha inexistente es inválida antes que cualquier otra cosa", () => {
    for (const texto of ["2023-02-29", "2026-04-31", "14/09/2026", "", null]) {
      expect(motivoFechaNoOperativa(texto, hoy), String(texto)).toBe("invalida");
    }
  });

  it("esFechaOperativa resume lo anterior", () => {
    expect(esFechaOperativa("2026-09-01", hoy)).toBe(true);
    expect(esFechaOperativa("1999-12-31", hoy)).toBe(false);
    expect(esFechaOperativa("2026-09-15", hoy)).toBe(false);
    expect(esFechaOperativa("2026-02-30", hoy)).toBe(false);
  });
});

describe("aFechaDeBase y deFechaDeBase", () => {
  it("produce medianoche UTC exacta del día indicado", () => {
    enCadaZona(() => {
      expect(aFechaDeBase("2026-09-14").toISOString()).toBe("2026-09-14T00:00:00.000Z");
      expect(aFechaDeBase("2024-02-29").toISOString()).toBe("2024-02-29T00:00:00.000Z");
    });
  });

  it("no confunde un año de dos cifras con 19xx", () => {
    // Date.UTC(99, 0, 1) es 1999; la frontera no debe heredar esa sorpresa.
    expect(aFechaDeBase("0099-01-01").getUTCFullYear()).toBe(99);
  });

  it("lanza FechaInvalida ante un texto inválido, sin devolver una fecha corrida", () => {
    for (const texto of ["2026-04-31", "2023-02-29", "14/09/2026", ""]) {
      expect(() => aFechaDeBase(texto), texto).toThrow(FechaInvalida);
    }
  });

  it("lee el @db.Date en UTC: medianoche UTC es ese día, no el anterior", () => {
    enCadaZona(() => {
      expect(deFechaDeBase(instante("2026-09-14T00:00:00.000Z"))).toBe("2026-09-14");
      // El 1 de enero a medianoche UTC son las 18:00 del 31 de diciembre en
      // Acapulco. Leerlo en la zona equivocada cambiaría el año.
      expect(deFechaDeBase(instante("2027-01-01T00:00:00.000Z"))).toBe("2027-01-01");
    });
  });

  it("ida y vuelta sin desplazamiento en cada día de un año bisiesto", () => {
    enCadaZona(() => {
      // 2024 tiene 366 días; se recorre a partir de una fecha fija en UTC.
      const inicio = Date.UTC(2024, 0, 1);
      for (let n = 0; n < 366; n++) {
        const fecha = new Date(inicio + n * 86_400_000);
        const texto = fecha.toISOString().slice(0, 10);
        expect(deFechaDeBase(aFechaDeBase(texto)), texto).toBe(texto);
      }
    });
  });
});

describe("formatearFecha", () => {
  it("muestra un @db.Date como DD/MM/AAAA en UTC", () => {
    enCadaZona(() => {
      expect(formatearFecha(instante("2026-09-14T00:00:00.000Z"))).toBe("14/09/2026");
      // Formateado en hora de México saldría 31/12/2025: el desplazamiento de E4.
      expect(formatearFecha(instante("2026-01-01T00:00:00.000Z"))).toBe("01/01/2026");
    });
  });

  it("acepta también el texto del formulario", () => {
    expect(formatearFecha("2026-09-14")).toBe("14/09/2026");
    expect(formatearFecha("2024-02-29")).toBe("29/02/2024");
  });

  it("con texto inválido lanza FechaInvalida", () => {
    expect(() => formatearFecha("2026-02-30")).toThrow(FechaInvalida);
  });
});

describe("formatearInstante", () => {
  it("muestra un instante en hora de México con reloj de 24 horas", () => {
    enCadaZona(() => {
      // 00:30 UTC del 15 son las 18:30 del 14 en Acapulco.
      expect(formatearInstante(instante("2026-09-15T00:30:00.000Z"))).toBe("14/09/2026 18:30");
      // Medianoche en México: 00:00, no 24:00.
      expect(formatearInstante(instante("2026-09-14T06:00:00.000Z"))).toBe("14/09/2026 00:00");
      expect(formatearInstante(instante("2026-09-14T05:59:00.000Z"))).toBe("13/09/2026 23:59");
    });
  });

  it("cruza el año en hora de México", () => {
    enCadaZona(() => {
      expect(formatearInstante(instante("2027-01-01T05:59:00.000Z"))).toBe("31/12/2026 23:59");
      expect(formatearInstante(instante("2027-01-01T06:00:00.000Z"))).toBe("01/01/2027 00:00");
    });
  });
});

describe("rangos de fechas", () => {
  it("leerRangoDeFechas descarta lo no operativo e intercambia un rango al revés", () => {
    expect(leerRangoDeFechas(" 2026-09-01 ", "2026-09-30", "2026-09-30")).toEqual({ desde: "2026-09-01", hasta: "2026-09-30" });
    expect(leerRangoDeFechas("2026-09-20", "2026-09-01", "2026-09-30")).toEqual({ desde: "2026-09-01", hasta: "2026-09-20" });
    expect(leerRangoDeFechas("1999-12-31", "2026-10-01", "2026-09-30")).toEqual({ desde: "", hasta: "" });
    expect(leerRangoDeFechas(["2026-09-01"], 20260901)).toEqual({ desde: "", hasta: "" });
  });

  it("diaSiguiente cruza mes y año", () => {
    expect(diaSiguiente("2026-09-30")).toBe("2026-10-01");
    expect(diaSiguiente("2026-12-31")).toBe("2027-01-01");
    expect(diaSiguiente("2028-02-28")).toBe("2028-02-29");
  });

  it("el día en México empieza a las 06:00 UTC, y a las 05:00 con el horario de verano previo a 2022", () => {
    enCadaZona(() => {
      expect(inicioDelDiaEnMexico("2026-09-30").toISOString()).toBe("2026-09-30T06:00:00.000Z");
      expect(inicioDelDiaEnMexico("2020-07-01").toISOString()).toBe("2020-07-01T05:00:00.000Z");
      expect(inicioDelDiaEnMexico("2027-01-01").toISOString()).toBe("2027-01-01T06:00:00.000Z");
    });
  });
});
