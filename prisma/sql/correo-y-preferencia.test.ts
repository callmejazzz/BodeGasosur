/*
  Fase 9, entrega 1 (997-correo-y-preferencia.sql), con el usuario de ejecución:

  · Prueba 19: la guarda de Usuario con la preferencia de alertas.
  · Prueba 20: quién escribe en las tablas de correo y sus transiciones.
  · El índice de correo de Usuario con lower(trim(correo)).
*/

import { randomUUID } from "node:crypto";
import type { PrismaClient, Rol } from "@prisma/client";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { crearCliente } from "../comun";
import { URL_PRUEBAS } from "../../pruebas/base-de-pruebas";
import { firmarToken } from "../../pruebas/tokens";

const llave = inject("llavePruebas");
let prisma: PrismaClient;
let app: Client;
let dueno: Client;

beforeAll(async () => {
  prisma = crearCliente(URL_PRUEBAS);
  app = new Client({ connectionString: inject("urlEjecucionPruebas") });
  dueno = new Client({ connectionString: URL_PRUEBAS });
  await Promise.all([app.connect(), dueno.connect()]);
});
afterAll(() => Promise.all([app.end(), dueno.end(), prisma.$disconnect()]));

const CHECK = "23514";
const UNICO = "23505";
const SIN_PRIVILEGIO = "42501";

/** SQLSTATE con el que falla; null si pasa. Se revierte, salvo que se pida confirmar. */
async function intentar(cliente: Client, pasos: () => Promise<unknown>, confirmar = false): Promise<string | null> {
  await cliente.query("BEGIN");
  try {
    await pasos();
    await cliente.query(confirmar ? "COMMIT" : "ROLLBACK");
    return null;
  } catch (error) {
    await cliente.query("ROLLBACK");
    return (error as { code?: string }).code ?? "desconocido";
  }
}

type Usuario = { id: string; clerkUserId: string; correo: string };

async function usuarioNuevo(rol: Rol, datos: { alertasCorreo?: boolean; activo?: boolean } = {}): Promise<Usuario> {
  const clerk = `user_cp_${randomUUID().slice(0, 8)}`;
  return prisma.usuario.create({
    data: { clerkUserId: clerk, correo: `${clerk}@prueba.test`, rol, ...datos },
    select: { id: true, clerkUserId: true, correo: true },
  });
}

const conLiga = (u: Usuario, sql: string, params: unknown[] = [], confirmar = false) =>
  intentar(
    app,
    async () => {
      await app.query("SELECT seguridad.fijar_actor($1)", [firmarToken(llave, u.clerkUserId)]);
      await app.query(sql, params);
    },
    confirmar,
  );

const comoOrigen = (origen: string, pasos: () => Promise<unknown>, confirmar = false) =>
  intentar(
    app,
    async () => {
      await app.query("SELECT set_config('app.origen', $1, true)", [origen]);
      await pasos();
    },
    confirmar,
  );

const sql = (texto: string, params: unknown[] = []) => () => app.query(texto, params);

const ALERTAS = `UPDATE "Usuario" SET "alertasCorreo" = $2 WHERE id = $1`;
const ALTA = `INSERT INTO "Usuario" (id, "clerkUserId", correo, rol, "alertasCorreo", "updatedAt") VALUES (uuid_generate_v7(), $1, $2, 'COMPRAS', $3, now())`;
const alta = (alertas: boolean) => {
  const clerk = `user_alta_${randomUUID().slice(0, 8)}`;
  return [clerk, `${clerk}@prueba.test`, alertas];
};

describe("guarda de Usuario con la preferencia de alertas (prueba 19)", () => {
  it("Superadmin, Compras y Jefe cambian su propia alertasCorreo", async () => {
    for (const rol of ["SUPERADMIN", "COMPRAS", "JEFE"] as const) {
      const u = await usuarioNuevo(rol);
      await expect(conLiga(u, ALERTAS, [u.id, true]), `${rol} la enciende`).resolves.toBeNull();
      const encendido = await usuarioNuevo(rol, { alertasCorreo: true });
      await expect(conLiga(encendido, ALERTAS, [encendido.id, false]), `${rol} la apaga`).resolves.toBeNull();
    }
  });

  it("nadie cambia la de otro, ni un Superadmin, y nadie da de alta a alguien con ella encendida (BG712)", async () => {
    const superadmin = await usuarioNuevo("SUPERADMIN");
    const otro = await usuarioNuevo("COMPRAS");
    const encendido = await usuarioNuevo("JEFE", { alertasCorreo: true });
    await expect(conLiga(superadmin, ALERTAS, [otro.id, true]), "encender la de otro").resolves.toBe("BG712");
    await expect(conLiga(superadmin, ALERTAS, [encendido.id, false]), "apagar la de otro").resolves.toBe("BG712");
    await expect(conLiga(otro, ALERTAS, [encendido.id, false]), "un Compras con la de otro").resolves.toBe("BG712");
    await expect(conLiga(superadmin, ALTA, alta(true)), "alta encendida").resolves.toBe("BG712");
    await expect(
      conLiga(superadmin, `${ALTA} ON CONFLICT ("clerkUserId") DO UPDATE SET "alertasCorreo" = EXCLUDED."alertasCorreo"`, [otro.clerkUserId, otro.correo, true]),
      "upsert que la enciende",
    ).resolves.toBe("BG712");
    await expect(conLiga(superadmin, ALTA, alta(false)), "un alta normal sigue pasando").resolves.toBeNull();
  });

  it("el webhook de Clerk no la toca (BG710), y sigue cambiando el correo", async () => {
    const u = await usuarioNuevo("COMPRAS");
    await expect(comoOrigen("clerk-webhook", sql(ALERTAS, [u.id, true]))).resolves.toBe("BG710");
    await expect(comoOrigen("clerk-webhook", sql(`UPDATE "Usuario" SET correo = $2 WHERE id = $1`, [u.id, `nuevo.${u.correo}`]))).resolves.toBeNull();
  });

  it("un Jefe que cambia otra columna de su fila sigue recibiendo BG708, también junto con la preferencia", async () => {
    const jefe = await usuarioNuevo("JEFE");
    await expect(conLiga(jefe, `UPDATE "Usuario" SET rol = 'SUPERADMIN' WHERE id = $1`, [jefe.id]), "su rol").resolves.toBe("BG708");
    await expect(conLiga(jefe, `UPDATE "Usuario" SET correo = 'otro@prueba.test' WHERE id = $1`, [jefe.id]), "su correo").resolves.toBe("BG708");
    await expect(
      conLiga(jefe, `UPDATE "Usuario" SET "alertasCorreo" = true, "puedeAutorizar" = true WHERE id = $1`, [jefe.id]),
      "la preferencia y su bandera",
    ).resolves.toBe("BG708");
  });

  it("el cambio propio deja en la bitácora un renglón con el propio usuario como actor y la fila completa", async () => {
    const compras = await usuarioNuevo("COMPRAS");
    await expect(conLiga(compras, ALERTAS, [compras.id, true], true)).resolves.toBeNull();
    const renglon = await prisma.bitacora.findFirstOrThrow({ where: { tabla: "Usuario", registroId: compras.id, accion: "ACTUALIZAR" } });
    expect(renglon).toMatchObject({ usuarioId: compras.id, verificacion: "liga" });
    const antes = renglon.antes as Record<string, unknown>;
    const despues = renglon.despues as Record<string, unknown>;
    expect(antes).toMatchObject({ id: compras.id, clerkUserId: compras.clerkUserId, correo: compras.correo, rol: "COMPRAS", activo: true, alertasCorreo: false });
    expect(despues).toMatchObject({ id: compras.id, clerkUserId: compras.clerkUserId, correo: compras.correo, rol: "COMPRAS", activo: true, alertasCorreo: true });
    expect(Object.keys(despues).sort()).toEqual(Object.keys(antes).sort());
  });

  it("un usuario nuevo empieza sin alertas", async () => {
    const u = await usuarioNuevo("JEFE");
    await expect(prisma.usuario.findUniqueOrThrow({ where: { id: u.id }, select: { alertasCorreo: true } })).resolves.toEqual({ alertasCorreo: false });
  });
});

describe("índice de correo de Usuario", () => {
  it("dos usuarios activos no comparten dirección, aunque cambien mayúsculas o espacios; uno inactivo sí puede", async () => {
    const sufijo = randomUUID().slice(0, 8);
    await prisma.usuario.create({ data: { clerkUserId: `user_ix_${sufijo}`, correo: `Dup.${sufijo}@Prueba.test`, rol: "JEFE" } });
    const insertar = (correo: string, activo: boolean) =>
      intentar(dueno, () =>
        dueno.query(`INSERT INTO "Usuario" (id, "clerkUserId", correo, rol, activo, "updatedAt") VALUES (uuid_generate_v7(), $1, $2, 'JEFE', $3, now())`, [
          `user_ix_${randomUUID().slice(0, 8)}`, correo, activo,
        ]),
      );
    await expect(insertar(`  dup.${sufijo}@prueba.test `, true), "activo").resolves.toBe(UNICO);
    await expect(insertar(`dup.${sufijo}@prueba.test`, false), "inactivo").resolves.toBeNull();
  });
});

// ─────────────────────────── Tablas de correo ───────────────────────────────

let dias = 0;
/** Una fecha operativa distinta por reserva: la evaluación es una por día. */
const nuevaFecha = () => new Date(Date.UTC(2031, 0, 1 + dias++)).toISOString().slice(0, 10);

const LOTE = `INSERT INTO "LoteCorreos" (id, fecha, numero, llave, remitente, asunto, html, texto, articulos)
  VALUES (uuid_generate_v7(), $1::date, $2, $3, 'BodeGasosur <avisos@avisos.prueba.test>', 'Stock bajo mínimo: 2 artículos', '<p>Alerta</p>', 'Alerta', 2) RETURNING id`;
const REGISTRO = `INSERT INTO "RegistroCorreos" (id, "loteId", posicion, fecha, "usuarioId", correo) VALUES (uuid_generate_v7(), $1, $2, $3::date, $4, $5) RETURNING id`;
const EVALUACION = `INSERT INTO "EvaluacionCorreos" (id, fecha, resultado, articulos, renglones, destinatarios, lotes) VALUES (uuid_generate_v7(), $1::date, $2, $3, $4, $5, $6)`;
const EVENTO = `INSERT INTO "EventoCorreo" (id, "svixId", tipo, "resendId", "registroId", anomalia, "etiquetaRecibida", "ocurridoEn")
  VALUES (uuid_generate_v7(), $1, $2, $3, $4, $5, $6, now())`;

type Reserva = { fecha: string; loteId: string; registros: string[] };

/** La reserva del día como la hará el resumen diario: lote, destinatarios y, al final, la evaluación. */
async function reservar(destinatarios: Usuario[], evaluar = true): Promise<Reserva> {
  const fecha = nuevaFecha();
  let loteId = "";
  const registros: string[] = [];
  const r = await comoOrigen(
    "resumen-diario",
    async () => {
      await app.query("SELECT candado_correos_del_dia($1)", [fecha]);
      loteId = (await app.query<{ id: string }>(LOTE, [fecha, 1, `resumen-${fecha}-1`])).rows[0].id;
      for (const [i, u] of destinatarios.entries()) {
        registros.push((await app.query<{ id: string }>(REGISTRO, [loteId, i, fecha, u.id, u.correo])).rows[0].id);
      }
      if (evaluar) await app.query(EVALUACION, [fecha, "CON_ENVIO", 2, 3, destinatarios.length, 1]);
    },
    true,
  );
  expect(r, "la reserva legítima").toBeNull();
  return { fecha, loteId, registros };
}

const ACEPTAR = `UPDATE "LoteCorreos" SET estado = 'ACEPTADO', "resueltoEn" = now() WHERE id = $1`;
const ENVIAR = `UPDATE "RegistroCorreos" SET estado = 'ENVIADO', "resendId" = $2 WHERE id = $1`;

describe("tablas de correo: quién escribe (prueba 20)", () => {
  it("el camino legítimo pasa: el resumen diario reserva y arrienda, y el webhook de Resend concilia y registra eventos", async () => {
    const [a, b] = [await usuarioNuevo("COMPRAS"), await usuarioNuevo("JEFE")];
    const { loteId, registros } = await reservar([a, b]);
    await expect(
      comoOrigen("resumen-diario", sql(`UPDATE "LoteCorreos" SET intentos = intentos + 1, "ultimoIntentoEn" = now(), "arrendadoHasta" = now() + interval '5 minutes' WHERE id = $1`, [loteId]), true),
      "arriendo",
    ).resolves.toBeNull();
    await expect(
      comoOrigen(
        "resend-webhook",
        async () => {
          await app.query(ACEPTAR, [loteId]);
          await app.query(ENVIAR, [registros[0], `re_${randomUUID()}`]);
          await app.query(EVENTO, [`msg_${randomUUID()}`, "email.delivered", `re_${randomUUID()}`, registros[0], null, null]);
          await app.query(EVENTO, [`msg_${randomUUID()}`, "email.bounced", `re_${randomUUID()}`, null, "ETIQUETA_DESCONOCIDA", "registro-ajeno"]);
        },
        true,
      ),
      "conciliación y eventos",
    ).resolves.toBeNull();
    await expect(comoOrigen("resumen-diario", sql(EVALUACION, [nuevaFecha(), "SIN_BAJO_MINIMO", 0, 0, 0, 0]))).resolves.toBeNull();
  });

  it("con resumen-diario y resend-webhook no se escribe fuera de sus tablas ni de sus operaciones (BG706)", async () => {
    const u = await usuarioNuevo("COMPRAS");
    const { fecha, loteId, registros } = await reservar([u]);
    const ajenas = [
      [`UPDATE "Usuario" SET correo = correo WHERE id = $1`, [u.id]],
      [`INSERT INTO "Bodega" (id, nombre, "updatedAt") VALUES (uuid_generate_v7(), $1, now())`, [`Bodega ${randomUUID()}`]],
      [`INSERT INTO "EventoWebhook" ("eventoId", tipo, payload) VALUES ($1, 'user.updated', '{}')`, [`msg_${randomUUID()}`]],
      [`UPDATE "Folio" SET siguiente = siguiente WHERE false`, []],
    ] as const;
    for (const origen of ["resumen-diario", "resend-webhook"]) {
      for (const [texto, params] of ajenas) {
        await expect(comoOrigen(origen, sql(texto, [...params])), `${origen}: ${texto}`).resolves.toBe("BG706");
      }
    }
    const otraFecha = nuevaFecha();
    const fuera = {
      "resend-webhook crea un lote": ["resend-webhook", LOTE, [otraFecha, 1, `resumen-${otraFecha}-1`]],
      "resend-webhook crea un destinatario": ["resend-webhook", REGISTRO, [loteId, 9, fecha, u.id, u.correo]],
      "resend-webhook evalúa": ["resend-webhook", EVALUACION, [otraFecha, "SIN_BAJO_MINIMO", 0, 0, 0, 0]],
      "resumen-diario registra un evento": ["resumen-diario", EVENTO, [`msg_${randomUUID()}`, "email.sent", null, registros[0], null, null]],
      "clerk-webhook toca un lote": ["clerk-webhook", ACEPTAR, [loteId]],
      "sin origen": ["", ENVIAR, [registros[0], "re_x"]],
    } as const;
    for (const [caso, [origen, texto, params]] of Object.entries(fuera)) {
      await expect(comoOrigen(origen, sql(texto, [...params])), caso).resolves.toBe("BG706");
    }
  });

  it("nadie con sesión escribe en ellas, ni el Superadmin ni con un origen declarado encima (BG706)", async () => {
    const superadmin = await usuarioNuevo("SUPERADMIN");
    const { fecha, loteId, registros } = await reservar([superadmin]);
    const otraFecha = nuevaFecha();
    const casos = [
      [EVALUACION, [otraFecha, "SIN_BAJO_MINIMO", 0, 0, 0, 0]],
      [LOTE, [otraFecha, 1, `resumen-${otraFecha}-1`]],
      [REGISTRO, [loteId, 5, fecha, superadmin.id, superadmin.correo]],
      [EVENTO, [`msg_${randomUUID()}`, "email.sent", null, registros[0], null, null]],
      [ACEPTAR, [loteId]],
      [ENVIAR, [registros[0], "re_x"]],
    ] as const;
    for (const [texto, params] of casos) {
      await expect(conLiga(superadmin, texto, [...params]), texto).resolves.toBe("BG706");
    }
    await expect(
      intentar(app, async () => {
        await app.query("SELECT seguridad.fijar_actor($1)", [firmarToken(llave, superadmin.clerkUserId)]);
        await app.query("SELECT set_config('app.origen', 'resend-webhook', true)");
        await app.query(ACEPTAR, [loteId]);
      }),
      "la liga gana al origen",
    ).resolves.toBe("BG706");
  });

  it("el usuario de la aplicación no borra filas ni modifica evaluaciones o eventos", async () => {
    for (const tabla of ["EvaluacionCorreos", "LoteCorreos", "RegistroCorreos", "EventoCorreo"]) {
      await expect(intentar(app, sql(`DELETE FROM "${tabla}" WHERE false`)), `borrar en ${tabla}`).resolves.toBe(SIN_PRIVILEGIO);
    }
    for (const tabla of ["EvaluacionCorreos", "EventoCorreo"]) {
      await expect(intentar(app, sql(`UPDATE "${tabla}" SET id = id WHERE false`)), `modificar ${tabla}`).resolves.toBe(SIN_PRIVILEGIO);
    }
    const { fecha } = await reservar([await usuarioNuevo("JEFE")]);
    await expect(
      intentar(dueno, () => dueno.query(`UPDATE "EvaluacionCorreos" SET renglones = renglones + 1 WHERE fecha = $1::date`, [fecha])),
      "ni el dueño modifica una evaluación",
    ).resolves.toBe(CHECK);
  });
});

describe("tablas de correo: transiciones (prueba 20)", () => {
  const conciliar = (texto: string, params: unknown[]) => comoOrigen("resend-webhook", sql(texto, params));

  it("no cambian el contenido, la llave, los integrantes ni su posición, tampoco para el dueño", async () => {
    const [a, b] = [await usuarioNuevo("COMPRAS"), await usuarioNuevo("JEFE")];
    const { loteId, registros } = await reservar([a, b]);
    for (const cambio of [`asunto = 'Otro asunto'`, `html = '<p>otro</p>'`, `texto = 'otro'`, `remitente = 'otro@x.test'`, `articulos = 3`, `llave = llave || 'x'`, `numero = 2`]) {
      await expect(conciliar(`UPDATE "LoteCorreos" SET ${cambio} WHERE id = $1`, [loteId]), cambio).resolves.toBe(CHECK);
    }
    for (const [cambio, params] of [
      [`"usuarioId" = $2`, [b.id]],
      [`correo = $2`, ["otra@prueba.test"]],
      [`posicion = $2`, [7]],
    ] as const) {
      await expect(conciliar(`UPDATE "RegistroCorreos" SET ${cambio} WHERE id = $1`, [registros[0], ...params]), cambio).resolves.toBe(CHECK);
    }
    await expect(intentar(dueno, () => dueno.query(`UPDATE "LoteCorreos" SET asunto = 'x' WHERE id = $1`, [loteId])), "el dueño").resolves.toBe(CHECK);
  });

  it("los integrantes se cierran con la evaluación, y la evaluación cuadra con lo reservado", async () => {
    const [a, b, c] = [await usuarioNuevo("COMPRAS"), await usuarioNuevo("JEFE"), await usuarioNuevo("JEFE")];
    const evaluada = await reservar([a]);
    await expect(comoOrigen("resumen-diario", sql(REGISTRO, [evaluada.loteId, 1, evaluada.fecha, b.id, b.correo])), "un destinatario más").resolves.toBe(CHECK);
    await expect(comoOrigen("resumen-diario", sql(LOTE, [evaluada.fecha, 2, `resumen-${evaluada.fecha}-2`])), "otro lote").resolves.toBe(CHECK);

    const abierta = await reservar([a, b], false);
    await expect(comoOrigen("resumen-diario", sql(EVALUACION, [abierta.fecha, "CON_ENVIO", 1, 1, 1, 1])), "cuenta de menos").resolves.toBe(CHECK);
    await expect(comoOrigen("resumen-diario", sql(EVALUACION, [abierta.fecha, "SIN_DESTINATARIOS", 1, 1, 0, 0])), "dice que no hubo nadie").resolves.toBe(CHECK);
    await expect(comoOrigen("resumen-diario", sql(EVALUACION, [abierta.fecha, "CON_ENVIO", 2, 3, 2, 2])), "lotes de más").resolves.toBe(CHECK);
    await expect(comoOrigen("resumen-diario", sql(REGISTRO, [abierta.loteId, 0, abierta.fecha, c.id, c.correo])), "posición ocupada").resolves.toBe(UNICO);
    await expect(comoOrigen("resumen-diario", sql(REGISTRO, [abierta.loteId, 100, abierta.fecha, c.id, c.correo])), "posición fuera de rango").resolves.toBe(CHECK);
    await expect(comoOrigen("resumen-diario", sql(REGISTRO, [abierta.loteId, 2, nuevaFecha(), c.id, c.correo])), "otra fecha que la del lote").resolves.toBe("23503");
    await expect(comoOrigen("resumen-diario", sql(EVALUACION, [abierta.fecha, "CON_ENVIO", 2, 3, 2, 1])), "la que cuadra").resolves.toBeNull();
  });

  it("no se sale de ENVIADO ni de ACEPTADO, ni se reemplaza un identificador de Resend", async () => {
    const u = await usuarioNuevo("COMPRAS");
    const { loteId, registros } = await reservar([u]);
    await expect(comoOrigen("resend-webhook", async () => {
      await app.query(ACEPTAR, [loteId]);
      await app.query(ENVIAR, [registros[0], "re_original"]);
    }, true)).resolves.toBeNull();

    for (const cambio of [`estado = 'PENDIENTE', "resueltoEn" = NULL`, `estado = 'RECHAZADO'`, `estado = 'SIN_CONFIRMAR'`]) {
      await expect(conciliar(`UPDATE "LoteCorreos" SET ${cambio} WHERE id = $1`, [loteId]), cambio).resolves.toBe(CHECK);
    }
    for (const cambio of [`estado = 'PENDIENTE', "resendId" = NULL`, `estado = 'FALLIDO', "resendId" = NULL`, `"resendId" = 're_otro'`]) {
      await expect(conciliar(`UPDATE "RegistroCorreos" SET ${cambio} WHERE id = $1`, [registros[0]]), cambio).resolves.toBe(CHECK);
    }
    await expect(intentar(dueno, () => dueno.query(`UPDATE "RegistroCorreos" SET "resendId" = 're_otro' WHERE id = $1`, [registros[0]])), "el dueño").resolves.toBe(CHECK);
    await expect(conciliar(`UPDATE "LoteCorreos" SET intentos = intentos + 1, "ultimoIntentoEn" = now() WHERE id = $1`, [loteId]), "un ACEPTADO se vuelve a pedir").resolves.toBeNull();
  });

  it("de un rechazo o de un día cerrado solo se pasa a la aceptación, y ENVIADO exige su identificador", async () => {
    const [a, b] = [await usuarioNuevo("COMPRAS"), await usuarioNuevo("JEFE")];
    const { loteId, registros } = await reservar([a, b]);
    await expect(comoOrigen("resend-webhook", async () => {
      await app.query(`UPDATE "LoteCorreos" SET estado = 'RECHAZADO', motivo = '403', "resueltoEn" = now() WHERE id = $1`, [loteId]);
      await app.query(`UPDATE "RegistroCorreos" SET estado = 'FALLIDO', motivo = '403' WHERE "loteId" = $1`, [loteId]);
    }, true)).resolves.toBeNull();

    await expect(conciliar(`UPDATE "LoteCorreos" SET estado = 'PENDIENTE', "resueltoEn" = NULL WHERE id = $1`, [loteId]), "regresar a pendiente").resolves.toBe(CHECK);
    await expect(conciliar(`UPDATE "LoteCorreos" SET intentos = 1, "ultimoIntentoEn" = now() WHERE id = $1`, [loteId]), "reintentar un rechazo").resolves.toBe(CHECK);
    await expect(conciliar(`UPDATE "RegistroCorreos" SET estado = 'SIN_CONFIRMAR' WHERE id = $1`, [registros[0]]), "de fallido a sin confirmar").resolves.toBe(CHECK);
    await expect(conciliar(`UPDATE "RegistroCorreos" SET estado = 'ENVIADO' WHERE id = $1`, [registros[0]]), "enviado sin identificador").resolves.toBe(CHECK);
    await expect(conciliar(ENVIAR, [registros[0], "re_tardio"]), "un evento lo contradice").resolves.toBeNull();
    await expect(conciliar(ACEPTAR, [loteId]), "el lote pasa a aceptado").resolves.toBeNull();

    const vencido = await reservar([a]);
    await expect(comoOrigen("resumen-diario", sql(`UPDATE "LoteCorreos" SET intentos = 2, "ultimoIntentoEn" = now() WHERE id = $1`, [vencido.loteId])), "intentos de dos en dos").resolves.toBe(CHECK);
    await expect(
      comoOrigen("resumen-diario", sql(`UPDATE "LoteCorreos" SET estado = 'VENCIDO', "resueltoEn" = now() WHERE id = $1`, [vencido.loteId]), true),
      "vence sin intentos",
    ).resolves.toBeNull();
    await expect(comoOrigen("resumen-diario", sql(`UPDATE "LoteCorreos" SET estado = 'SIN_CONFIRMAR' WHERE id = $1`, [vencido.loteId])), "de vencido a sin confirmar").resolves.toBe(CHECK);
  });

  it("un evento es asociado o anómalo, nunca los dos ni ninguno", async () => {
    const { registros } = await reservar([await usuarioNuevo("COMPRAS")]);
    const evento = (registroId: string | null, anomalia: string | null, etiqueta: string | null) =>
      comoOrigen("resend-webhook", sql(EVENTO, [`msg_${randomUUID()}`, "email.sent", "re_x", registroId, anomalia, etiqueta]));
    await expect(evento(registros[0], "ID_DISTINTO", null), "los dos").resolves.toBe(CHECK);
    await expect(evento(null, null, null), "ninguno").resolves.toBe(CHECK);
    await expect(evento(registros[0], null, "registro-x"), "etiqueta en un asociado").resolves.toBe(CHECK);
    const repetido = `msg_${randomUUID()}`;
    await expect(comoOrigen("resend-webhook", sql(EVENTO, [repetido, "email.sent", "re_x", registros[0], null, null]), true)).resolves.toBeNull();
    await expect(
      comoOrigen("resend-webhook", sql(`${EVENTO} ON CONFLICT ("svixId") DO NOTHING`, [repetido, "email.sent", "re_x", registros[0], null, null])),
      "repetido sin error",
    ).resolves.toBeNull();
    await expect(prisma.eventoCorreo.count({ where: { svixId: repetido } })).resolves.toBe(1);
  });
});
