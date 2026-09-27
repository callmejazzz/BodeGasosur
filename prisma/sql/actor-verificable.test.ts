/*
  El actor verificable (95-actor-verificable.sql y 96-actor-exigido.sql).

  · El verificador RS256 contra los vectores de Wycheproof, contra crypto.verify
    de Node (una implementación independiente) y contra los casos estrictos de
    RFC 8017, con firmas armadas a mano.
  · El token: cada reclamación, cada encabezado y cada forma de rechazo.
  · La liga, como la usa el usuario de ejecución: uso confirmado, carreras,
    suplantación con app.usuario_id y un token que vence esperando un candado.
  · Lo que la fase B exige: columnas de actor, Usuario, el alcance del webhook,
    las tablas sin bitácora y los registros de acceso. Y la marca «heredada»
    de la fase A, con la función de esa fase.
*/

import { constants, createHash, createHmac, createPublicKey, createSign, generateKeyPairSync, privateEncrypt, randomBytes, randomUUID, verify, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { crearCliente } from "../comun";
import { URL_PRUEBAS } from "../../pruebas/base-de-pruebas";
import { bloqueadaPor, conexion, desenlace, type Conexion } from "../../pruebas/concurrencia";
import { sembrarSalidas, type EntornoSalidas } from "../../pruebas/semilla-salidas";
import { firmarToken, type LlaveDePrueba } from "../../pruebas/tokens";
import { cargarJwk, type JwkRsa } from "../../scripts/llaves-clerk";
import { aFechaDeBase, hoyEnMexico } from "../../src/lib/fechas";

const RAIZ = join(import.meta.dirname, "../..");
const llave: LlaveDePrueba = inject("llavePruebas");
const urlApp = inject("urlEjecucionPruebas");

let prisma: PrismaClient;
let dueno: Conexion;
let app: Conexion;
let e: EntornoSalidas;

beforeAll(async () => {
  prisma = crearCliente(URL_PRUEBAS);
  dueno = await conexion(URL_PRUEBAS);
  app = await conexion(urlApp);
  e = await sembrarSalidas(prisma);
});
afterAll(async () => {
  await Promise.all([dueno.end(), app.end(), prisma.$disconnect()]);
});

/** SQLSTATE con el que falla; null si pasa. Todo dentro de una transacción que se revierte. */
async function intentar(cliente: Client, pasos: () => Promise<unknown>): Promise<string | null> {
  await cliente.query("BEGIN");
  try {
    await pasos();
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? "desconocido";
  } finally {
    await cliente.query("ROLLBACK");
  }
}

const clerkDe = async (id: string) => (await prisma.usuario.findUniqueOrThrow({ where: { id } })).clerkUserId;
const tokenDe = async (id: string, cambios?: Parameters<typeof firmarToken>[2]) => firmarToken(llave, await clerkDe(id), cambios);
const ligar = (cliente: Client, token: string) => cliente.query<{ actor: string }>("SELECT seguridad.fijar_actor($1) AS actor", [token]);
const probar = (token: string) => dueno.query("SELECT * FROM seguridad.probar_token($1)", [token]);
/** «BG701 motivo» para un token inválido, «BG702» para una llave sin cargar, null si pasa. */
const rechazo = (token: string) =>
  probar(token).then(
    () => null,
    (error: { code?: string; message?: string }) =>
      error.code === "BG701" ? `BG701 ${/\(([^)]+)\)\.$/.exec(error.message ?? "")?.[1]}` : (error.code ?? "desconocido"),
  );
const codigoDe = (consulta: Promise<unknown>) =>
  consulta.then(
    () => null,
    (error: { code?: string }) => error.code ?? "desconocido",
  );

async function usuarioNuevo(datos: { rol: "SUPERADMIN" | "COMPRAS" | "JEFE"; puedeAutorizar?: boolean; activo?: boolean }) {
  const sufijo = randomUUID().slice(0, 8);
  return prisma.usuario.create({ data: { clerkUserId: `user_av_${sufijo}`, correo: `av.${sufijo}@prueba.test`, ...datos } });
}

// ─────────────────────────────── Verificador ─────────────────────────────────

const VERIFICAR_LOTE = `
  SELECT t.i, seguridad.firma_rs256_valida(t.m, t.s, $1, $2) AS valida
    FROM unnest($3::int[], $4::bytea[], $5::bytea[]) AS t(i, m, s)`;

async function verificarLote(n: Buffer, e: Buffer, casos: { m: Buffer; s: Buffer }[]): Promise<boolean[]> {
  const { rows } = await dueno.query<{ i: number; valida: boolean }>(VERIFICAR_LOTE, [
    n, e, casos.map((_, i) => i), casos.map((c) => c.m), casos.map((c) => c.s),
  ]);
  return rows.sort((a, b) => a.i - b.i).map((r) => r.valida);
}

const jwkDe = (publica: KeyObject) => publica.export({ format: "jwk" }) as JwkRsa;
const bytes = (b64u: string) => Buffer.from(b64u, "base64url");

describe("verificador RS256", () => {
  it.each([2048, 3072, 4096])("Wycheproof, %i bits: acepta lo válido y rechaza lo inválido y lo «aceptable»", async (bits) => {
    type Prueba = { tcId: number; comment: string; flags: string[]; msg: string; sig: string; result: "valid" | "invalid" | "acceptable" };
    const archivo = JSON.parse(readFileSync(join(RAIZ, `pruebas/vectores/rsa_signature_${bits}_sha256_test.json`), "utf8")) as {
      testGroups: { keyJwk: JwkRsa; tests: Prueba[] }[];
    };
    let probadas = 0;
    for (const grupo of archivo.testGroups) {
      const resultados = await verificarLote(
        bytes(grupo.keyJwk.n!),
        bytes(grupo.keyJwk.e!),
        grupo.tests.map((t) => ({ m: Buffer.from(t.msg, "hex"), s: Buffer.from(t.sig, "hex") })),
      );
      grupo.tests.forEach((t, i) => {
        // «acceptable» es el DigestInfo sin NULL: Clerk siempre lo manda con NULL,
        // así que el verificador estricto lo rechaza.
        expect(resultados[i], `tcId ${t.tcId} ${t.comment} [${t.flags.join(", ")}]`).toBe(t.result === "valid");
      });
      probadas += grupo.tests.length;
    }
    expect(probadas).toBeGreaterThan(250);
  });

  it.each([2048, 3072, 4096])("coincide con crypto.verify de Node en %i bits, con firmas y mensajes mutados", async (bits) => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: bits });
    const jwk = jwkDe(publicKey);
    const casos: { m: Buffer; s: Buffer }[] = [];
    for (let i = 0; i < 10; i++) {
      const m = randomBytes(1 + i * 13);
      const s = createSign("RSA-SHA256").update(m).sign(privateKey);
      const sMutada = Buffer.from(s);
      sMutada[(i * 37) % s.length] ^= 1 << i % 8;
      const mMutado = Buffer.from(m);
      mMutado[i % m.length] ^= 0x80;
      casos.push({ m, s }, { m, s: sMutada }, { m: mMutado, s }, { m, s: randomBytes(s.length) });
    }
    // Una firma con un bit cambiado en cada una de sus posiciones.
    const m = Buffer.from("barrido byte a byte");
    const s = createSign("RSA-SHA256").update(m).sign(privateKey);
    for (let i = 0; i < s.length; i++) {
      const mutada = Buffer.from(s);
      mutada[i] ^= 1 << i % 8;
      casos.push({ m, s: mutada });
    }

    const enNode = casos.map((c) => verify("sha256", c.m, publicKey, c.s));
    const enBase = await verificarLote(bytes(jwk.n!), bytes(jwk.e!), casos);
    expect(enBase).toEqual(enNode);
    expect(enBase.filter(Boolean)).toHaveLength(10);
  });

  describe("casos estrictos de RFC 8017, con firmas armadas a mano", () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = jwkDe(publicKey);
    const n = bytes(jwk.n!);
    const k = n.length;
    const mensaje = Buffer.from("BodeGasosur");
    const DIGEST_SHA256 = Buffer.from("3031300d060960864801650304020105000420", "hex");

    /** EMSA-PKCS1-v1_5 con piezas intercambiables, firmado en crudo (s = EM^d mod n). */
    function firmar(piezas: { tipo?: number; relleno?: Buffer; prefijo?: Buffer; hash?: Buffer; cola?: Buffer } = {}) {
      const hash = piezas.hash ?? createHash("sha256").update(mensaje).digest();
      const prefijo = piezas.prefijo ?? DIGEST_SHA256;
      const cola = piezas.cola ?? Buffer.alloc(0);
      const relleno = piezas.relleno ?? Buffer.alloc(k - 3 - prefijo.length - hash.length - cola.length, 0xff);
      const em = Buffer.concat([Buffer.from([0x00, piezas.tipo ?? 0x01]), relleno, Buffer.from([0x00]), prefijo, hash, cola]);
      expect(em.length).toBe(k);
      return privateEncrypt({ key: privateKey, padding: constants.RSA_NO_PADDING }, em);
    }
    const valida = (s: Buffer, m = mensaje) =>
      dueno.query<{ v: boolean }>("SELECT seguridad.firma_rs256_valida($1, $2, $3, $4) AS v", [m, s, n, bytes(jwk.e!)]).then((r) => r.rows[0].v);

    it("la codificación exacta pasa en la base y en Node: el armado a mano es correcto", async () => {
      const s = firmar();
      expect(verify("sha256", mensaje, publicKey, s)).toBe(true);
      await expect(valida(s)).resolves.toBe(true);
    });

    it("rechaza cada desviación del relleno y del DigestInfo", async () => {
      const conPsAlterado = Buffer.alloc(k - 3 - 19 - 32, 0xff);
      conPsAlterado[5] = 0xfe;
      const sha512 = createHash("sha512").update(mensaje).digest();
      const casos: Record<string, Buffer> = {
        "tipo de bloque 02": firmar({ tipo: 0x02 }),
        "un octeto del relleno distinto de FF": firmar({ relleno: conPsAlterado }),
        "DigestInfo sin NULL": firmar({ prefijo: Buffer.from("302f300b06096086480165030402010420", "hex") }),
        "DigestInfo de SHA-512 con su hash": firmar({ prefijo: Buffer.from("3051300d060960864801650304020305000440", "hex"), hash: sha512 }),
        "DigestInfo de SHA-1": firmar({ prefijo: Buffer.from("3021300906052b0e03021a05000414", "hex"), hash: createHash("sha256").update(mensaje).digest().subarray(0, 20) }),
        "basura después del hash": firmar({ cola: Buffer.from("00ff", "hex") }),
        "hash de otro mensaje": firmar({ hash: createHash("sha256").update("otro").digest() }),
      };
      for (const [nombre, s] of Object.entries(casos)) {
        await expect(valida(s), nombre).resolves.toBe(false);
      }
    });

    it("rechaza firmas de otro largo, s ≥ n y valores triviales", async () => {
      const s = firmar();
      await expect(valida(s.subarray(1)), "un octeto menos").resolves.toBe(false);
      await expect(valida(Buffer.concat([Buffer.from([0]), s])), "un octeto de más").resolves.toBe(false);
      await expect(valida(n), "s = n").resolves.toBe(false);
      await expect(valida(Buffer.alloc(k, 0xff)), "s > n").resolves.toBe(false);
      await expect(valida(Buffer.alloc(k)), "s = 0").resolves.toBe(false);
      const uno = Buffer.alloc(k);
      uno[k - 1] = 1;
      await expect(valida(uno), "s = 1").resolves.toBe(false);
    });
  });
});

// ──────────────────────────────── El token ───────────────────────────────────

describe("token de identidad", () => {
  it("un token de la plantilla pasa y dice su kid, su sub y su vida", async () => {
    const { rows } = await probar(firmarToken(llave, "user_prueba"));
    expect(rows[0]).toMatchObject({ kid: llave.kid, sub: "user_prueba", vida_segundos: 30 });
  });

  it("rechaza algoritmos, encabezados y llaves que no son los de la plantilla", async () => {
    const publicaPem = createPublicKey(llave.privadaPem).export({ type: "spki", format: "pem" }).toString();
    const otra = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const firmaCon = (clave: KeyObject) => (cuerpo: string) => createSign("RSA-SHA256").update(cuerpo).sign(clave).toString("base64url");
    const casos: Record<string, [string, string]> = {
      "alg none": [firmarToken(llave, "u", { encabezado: { alg: "none" }, firma: () => "AA" }), "BG701 alg"],
      "HS256 con la llave pública como secreto": [
        firmarToken(llave, "u", { encabezado: { alg: "HS256" }, firma: (c) => createHmac("sha256", publicaPem).update(c).digest("base64url") }),
        "BG701 alg",
      ],
      "RS512": [firmarToken(llave, "u", { encabezado: { alg: "RS512" } }), "BG701 alg"],
      "encabezado con crit": [firmarToken(llave, "u", { encabezado: { crit: ["exp"] } }), "BG701 crit"],
      "sin kid": [firmarToken(llave, "u", { encabezado: { kid: undefined } }), "BG701 kid"],
      "firma de otra llave RSA con el kid correcto": [firmarToken(llave, "u", { firma: firmaCon(otra.privateKey) }), "BG701 firma"],
      "kid desconocido": [firmarToken(llave, "u", { encabezado: { kid: "no-cargado" } }), "BG702"],
    };
    for (const [nombre, [token, esperado]] of Object.entries(casos)) {
      await expect(rechazo(token), nombre).resolves.toBe(esperado);
    }
  });

  it("una llave desactivada deja de aceptarse", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const kid = `inactiva-${randomUUID().slice(0, 8)}`;
    await cargarJwk(dueno, { ...jwkDe(publicKey), kid }, llave.emisor);
    const propia: LlaveDePrueba = { ...llave, kid, privadaPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
    await expect(rechazo(firmarToken(propia, "u"))).resolves.toBeNull();
    await dueno.query("SELECT seguridad.desactivar_llave($1)", [kid]);
    await expect(rechazo(firmarToken(propia, "u"))).resolves.toBe("BG702");
  });

  it("rechaza reclamaciones fuera de contrato: emisor, audiencia, tiempos, sub y jti", async () => {
    const ahora = Math.floor(Date.now() / 1000);
    const casos: Record<string, [Record<string, unknown>, string]> = {
      "otro emisor": [{ iss: "https://otra.clerk.accounts.dev" }, "iss"],
      "otra audiencia": [{ aud: "otra" }, "aud"],
      "audiencia como arreglo": [{ aud: [llave.audiencia] }, "aud"],
      "token de sesión, sin aud": [{ aud: undefined, sid: "sess_123" }, "aud"],
      vencido: [{ iat: ahora - 120, nbf: ahora - 120, exp: ahora - 10 }, "vencido"],
      "nbf futuro": [{ nbf: ahora + 60, exp: ahora + 90 }, "nbf"],
      "iat futuro": [{ iat: ahora + 60, exp: ahora + 90 }, "iat"],
      "vida de una hora": [{ exp: ahora + 3600 }, "vida"],
      "vida de 61 s, sobre el tope": [{ exp: ahora + 61 }, "vida"],
      "exp antes que iat": [{ iat: ahora, exp: ahora - 1 }, "vida"],
      "exp como texto": [{ exp: String(ahora + 60) }, "tiempos"],
      "sin sub": [{ sub: undefined }, "sub"],
      "sub vacío": [{ sub: "" }, "sub"],
      "sin jti": [{ jti: undefined }, "jti"],
    };
    for (const [nombre, [carga, motivo]] of Object.entries(casos)) {
      await expect(rechazo(firmarToken(llave, "user_prueba", { carga })), nombre).resolves.toBe(`BG701 ${motivo}`);
    }
  });

  it("acepta hasta 60 s de vida, el doble de la plantilla", async () => {
    const ahora = Math.floor(Date.now() / 1000);
    await expect(rechazo(firmarToken(llave, "user_prueba", { carga: { exp: ahora + 60 } }))).resolves.toBeNull();
    const { rows } = await dueno.query<{ vida_maxima: number }>("SELECT vida_maxima FROM seguridad.llave_publica WHERE kid = $1", [llave.kid]);
    expect(rows[0].vida_maxima).toBe(60);
  });

  it("rechaza lo mal formado sin intentar interpretarlo", async () => {
    const bueno = firmarToken(llave, "u");
    const [h, p, s] = bueno.split(".");
    const casos: Record<string, [string, string]> = {
      "dos segmentos": [`${h}.${p}`, "forma"],
      "con relleno =": [`${h}.${p}=.${s}`, "forma"],
      "encabezado que no es JSON": [`${Buffer.from("no-json").toString("base64url")}.${p}.${s}`, "json"],
      "carga que es un arreglo": [`${h}.${Buffer.from("[1]").toString("base64url")}.${s}`, "json"],
      "más de 4 KB": [firmarToken(llave, "u", { carga: { relleno: "x".repeat(4096) } }), "forma"],
      vacío: ["", "forma"],
    };
    for (const [nombre, [token, motivo]] of Object.entries(casos)) {
      await expect(rechazo(token), nombre).resolves.toBe(`BG701 ${motivo}`);
    }
  });
});

// ──────────────────────────────── La liga ────────────────────────────────────

describe("fijar_actor, desde el usuario de ejecución", () => {
  const bodega = () => app.query(`INSERT INTO "Bodega" (id, nombre, "updatedAt") VALUES (uuid_generate_v7(), $1, now()) RETURNING id`, [`Liga ${randomUUID()}`]);
  const ultimaBitacora = (registroId: string) =>
    app.query<{ usuarioId: string | null; verificacion: string; jti: string | null }>(
      `SELECT "usuarioId", verificacion, jti FROM "Bitacora" WHERE "registroId" = $1 ORDER BY "ocurridoEn" DESC LIMIT 1`,
      [registroId],
    ).then((r) => r.rows[0]);

  it("liga al actor del token, y la bitácora lo registra con su jti", async () => {
    const u = e.usuarios.COMPRAS;
    const jti = randomUUID();
    await intentar(app, async () => {
      await expect(ligar(app, await tokenDe(u.id, { carga: { jti } })).then((r) => r.rows[0].actor)).resolves.toBe(u.id);
      const { rows } = await bodega();
      await expect(ultimaBitacora(rows[0].id)).resolves.toEqual({ usuarioId: u.id, verificacion: "liga", jti });
    });
  });

  it("app.usuario_id no suplanta a nadie: sin liga se rechaza, y con liga se ignora", async () => {
    const [actor, otro] = [e.usuarios.COMPRAS, e.usuarios.SUPERADMIN];
    await expect(
      intentar(app, async () => {
        await app.query("SELECT set_config('app.usuario_id', $1, true)", [otro.id]);
        await bodega();
      }),
    ).resolves.toBe("BG706");
    await intentar(app, async () => {
      await ligar(app, await tokenDe(actor.id));
      await app.query("SELECT set_config('app.usuario_id', $1, true)", [otro.id]);
      const { rows } = await bodega();
      await expect(ultimaBitacora(rows[0].id)).resolves.toMatchObject({ usuarioId: actor.id, verificacion: "liga" });
    });
  });

  it("rechaza a un usuario inactivo o inexistente, y un segundo actor en la misma transacción", async () => {
    const inactivo = await usuarioNuevo({ rol: "COMPRAS", activo: false });
    await expect(intentar(app, async () => ligar(app, await tokenDe(inactivo.id)))).resolves.toBe("BG705");
    await expect(intentar(app, () => ligar(app, firmarToken(llave, "user_que_no_existe")))).resolves.toBe("BG705");
    await expect(
      intentar(app, async () => {
        await ligar(app, await tokenDe(e.usuarios.COMPRAS.id));
        await ligar(app, await tokenDe(e.usuarios.SUPERADMIN.id));
      }),
    ).resolves.toBe("BG704");
  });

  it("uso confirmado: de dos usos concurrentes solo uno confirma, y tras un rollback se puede reintentar", async () => {
    const token = await tokenDe(e.usuarios.COMPRAS.id);
    const otra = await conexion(urlApp);
    try {
      await app.query("BEGIN");
      await ligar(app, token);
      await otra.query("BEGIN");
      const segunda = desenlace(ligar(otra, token));
      await bloqueadaPor(dueno, app.pid);
      await app.query("COMMIT");
      const r = await segunda;
      expect(r.ok ? null : (r.error as { code?: string }).code).toBe("BG703");
      await otra.query("ROLLBACK");

      const reintento = await tokenDe(e.usuarios.COMPRAS.id);
      await app.query("BEGIN");
      await ligar(app, reintento);
      await app.query("ROLLBACK");
      await expect(intentar(app, () => ligar(app, reintento))).resolves.toBeNull();
    } finally {
      await otra.end();
    }
  });

  it("una operación que espera un candado hasta que vence el token confirma con el actor ya ligado", async () => {
    const ahora = Math.floor(Date.now() / 1000);
    const token = await tokenDe(e.usuarios.COMPRAS.id, { carga: { iat: ahora, nbf: ahora, exp: ahora + 1 } });
    const candado = await conexion(URL_PRUEBAS);
    try {
      await candado.query("SELECT pg_advisory_lock(720001)");
      await app.query("BEGIN");
      await ligar(app, token);
      const espera = app.query("SELECT pg_advisory_xact_lock_shared(720001)");
      await bloqueadaPor(dueno, candado.pid);
      await new Promise((listo) => setTimeout(listo, 2500));
      await candado.query("SELECT pg_advisory_unlock(720001)");
      await espera;
      const { rows } = await bodega();
      await app.query("COMMIT");
      const fila = await prisma.bitacora.findFirstOrThrow({ where: { registroId: rows[0].id } });
      expect(fila).toMatchObject({ usuarioId: e.usuarios.COMPRAS.id, verificacion: "liga" });
    } finally {
      await candado.end();
    }
  });

  it("borra las ligas vencidas al ligar otra", async () => {
    await dueno.query("BEGIN");
    const { rows } = await dueno.query<{ xid: string }>(
      `INSERT INTO seguridad.liga_actor VALUES (pg_current_xact_id(), $1, $2, now() - interval '1 hour') RETURNING xid::text`,
      [e.usuarios.COMPRAS.id, `vencida-${randomUUID()}`],
    );
    await dueno.query("COMMIT");
    await app.query("BEGIN");
    await ligar(app, await tokenDe(e.usuarios.COMPRAS.id));
    await app.query("COMMIT");
    const { rowCount } = await dueno.query("SELECT 1 FROM seguridad.liga_actor WHERE xid = $1::xid8", [rows[0].xid]);
    expect(rowCount).toBe(0);
  });
});

// ─────────────────────────────── Fase B ──────────────────────────────────────

describe("fase B: lo que se exige al usuario de ejecución", () => {
  async function salidaSolicitada() {
    const m = await prisma.movimiento.create({
      data: {
        tipo: "SALIDA", estatus: "SOLICITADA", fecha: aFechaDeBase(hoyEnMexico()),
        bodegaOrigenId: e.bodegaId, estacionId: e.estacionId, creadoPorId: e.usuarios.COMPRAS.id,
        llaveIdempotencia: randomUUID(),
      },
    });
    await prisma.movimientoPartida.create({
      data: { movimientoId: m.id, articuloId: e.articuloSueltoId, orden: 1, presentacionCapturada: "UNIDAD", cantidadCapturada: 1, factorConversion: 1, cantidad: 1 },
    });
    return m;
  }

  describe("columnas de actor de Movimiento", () => {
    it("la transición legítima pasa: la columna toma al actor ligado", async () => {
      const m = await salidaSolicitada();
      const autorizador = e.autorizadores.JEFE;
      await expect(
        intentar(app, async () => {
          await ligar(app, await tokenDe(autorizador.id));
          await app.query(`UPDATE "Movimiento" SET estatus = 'AUTORIZADA', "autorizadoPorId" = $2, "autorizadoEn" = now() WHERE id = $1`, [m.id, autorizador.id]);
        }),
      ).resolves.toBeNull();
    });

    it("rechaza otro actor, reasignar una columna o cambiar al creador", async () => {
      const m = await salidaSolicitada();
      const autorizador = e.autorizadores.JEFE;
      const token = () => tokenDe(autorizador.id);
      await expect(
        intentar(app, async () => {
          await ligar(app, await token());
          await app.query(`UPDATE "Movimiento" SET estatus = 'AUTORIZADA', "autorizadoPorId" = $2, "autorizadoEn" = now() WHERE id = $1`, [m.id, e.autorizadores.COMPRAS.id]);
        }),
        "otro actor",
      ).resolves.toBe("BG707");
      await expect(
        intentar(app, async () => {
          await ligar(app, await token());
          await app.query(`UPDATE "Movimiento" SET "creadoPorId" = $2 WHERE id = $1`, [m.id, autorizador.id]);
        }),
        "cambiar al creador",
      ).resolves.toBe("BG707");

      // Autorizada por el dueño (de confianza); otro autorizador intenta reasignarla.
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.usuario_id', ${e.autorizadores.COMPRAS.id}, true)`;
        await tx.movimiento.update({ where: { id: m.id }, data: { estatus: "AUTORIZADA", autorizadoPorId: e.autorizadores.COMPRAS.id, autorizadoEn: new Date() } });
      });
      await expect(
        intentar(app, async () => {
          await ligar(app, await token());
          await app.query(`UPDATE "Movimiento" SET "autorizadoPorId" = $2 WHERE id = $1`, [m.id, autorizador.id]);
        }),
        "reasignar",
      ).resolves.toBe("BG707");
    });

    it("al insertar, el creador es el actor y el solicitante puede ser cualquier Persona", async () => {
      const compras = e.usuarios.COMPRAS;
      const insertar = (creadoPorId: string, autorizadoPorId: string | null) =>
        app.query(
          `INSERT INTO "Movimiento" (id, tipo, estatus, fecha, "bodegaOrigenId", "estacionId", "creadoPorId", "autorizadoPorId", "solicitadoPorId", "llaveIdempotencia", "updatedAt")
           VALUES (uuid_generate_v7(), 'SALIDA', 'SOLICITADA', current_date, $1, $2, $3, $4, $5, gen_random_uuid(), now())`,
          [e.bodegaId, e.estacionId, creadoPorId, autorizadoPorId, e.personaId],
        );
      const conLiga = async (paso: () => Promise<unknown>) =>
        intentar(app, async () => {
          await ligar(app, await tokenDe(compras.id));
          await paso();
        });
      await expect(conLiga(() => insertar(compras.id, null)), "válido, con solicitante").resolves.toBeNull();
      await expect(conLiga(() => insertar(e.usuarios.SUPERADMIN.id, null)), "otro creador").resolves.toBe("BG707");
      await expect(conLiga(() => insertar(compras.id, compras.id)), "nace autorizada").resolves.toBe("BG707");
    });
  });

  describe("Usuario", () => {
    it("con el token de un usuario común no se toca ningún usuario, ni el propio", async () => {
      const compras = await usuarioNuevo({ rol: "COMPRAS" });
      const conLiga = async (sql: string, params: unknown[]) =>
        intentar(app, async () => {
          await ligar(app, await tokenDe(compras.id));
          await app.query(sql, params);
        });
      await expect(conLiga(`UPDATE "Usuario" SET rol = 'SUPERADMIN' WHERE id = $1`, [compras.id]), "su rol").resolves.toBe("BG708");
      await expect(conLiga(`UPDATE "Usuario" SET "puedeAutorizar" = true WHERE id = $1`, [compras.id]), "su bandera").resolves.toBe("BG708");
      await expect(conLiga(`UPDATE "Usuario" SET correo = 'nuevo@prueba.test' WHERE id = $1`, [compras.id]), "su correo").resolves.toBe("BG708");
      await expect(conLiga(`UPDATE "Usuario" SET activo = false WHERE id = $1`, [e.usuarios.JEFE.id]), "el estado de otro").resolves.toBe("BG708");
      await expect(
        conLiga(`INSERT INTO "Usuario" (id, "clerkUserId", correo, rol, "updatedAt") VALUES (uuid_generate_v7(), $1, $2, 'SUPERADMIN', now())`, [
          `user_${randomUUID()}`, `${randomUUID()}@prueba.test`,
        ]),
        "crear",
      ).resolves.toBe("BG708");
      await expect(conLiga(`DELETE FROM "Usuario" WHERE id = $1`, [compras.id]), "borrar").resolves.toBe("42501");
    });

    it("un superadmin sí administra usuarios, pero nadie cambia un clerkUserId", async () => {
      const superadmin = await usuarioNuevo({ rol: "SUPERADMIN" });
      const objetivo = await usuarioNuevo({ rol: "COMPRAS" });
      const conLiga = async (sql: string, params: unknown[]) =>
        intentar(app, async () => {
          await ligar(app, await tokenDe(superadmin.id));
          await app.query(sql, params);
        });
      await expect(conLiga(`UPDATE "Usuario" SET rol = 'JEFE', "puedeAutorizar" = true WHERE id = $1`, [objetivo.id])).resolves.toBeNull();
      await expect(conLiga(`UPDATE "Usuario" SET "clerkUserId" = 'user_otro' WHERE id = $1`, [objetivo.id])).resolves.toBe("BG709");
      await expect(intentar(dueno, () => dueno.query(`UPDATE "Usuario" SET "clerkUserId" = 'user_otro' WHERE id = $1`, [objetivo.id])), "ni el dueño").resolves.toBe("BG709");
      // El upsert de la administración de accesos y el del arranque no reescriben clerkUserId.
      await expect(
        conLiga(
          `INSERT INTO "Usuario" (id, "clerkUserId", correo, rol, "updatedAt") VALUES (uuid_generate_v7(), $1, 'upsert@prueba.test', 'COMPRAS', now())
           ON CONFLICT ("clerkUserId") DO UPDATE SET correo = EXCLUDED.correo, rol = EXCLUDED.rol`,
          [objetivo.clerkUserId],
        ),
      ).resolves.toBeNull();
    });

    it("el webhook sin liga solo cambia el correo o da de baja", async () => {
      const u = await usuarioNuevo({ rol: "COMPRAS" });
      const inactivo = await usuarioNuevo({ rol: "COMPRAS", activo: false });
      const comoWebhook = (sql: string, params: unknown[]) =>
        intentar(app, async () => {
          await app.query("SELECT set_config('app.origen', 'clerk-webhook', true)");
          await app.query(sql, params);
        });
      await expect(comoWebhook(`UPDATE "Usuario" SET correo = 'webhook@prueba.test' WHERE id = $1`, [u.id]), "correo").resolves.toBeNull();
      await expect(comoWebhook(`UPDATE "Usuario" SET activo = false WHERE id = $1`, [u.id]), "baja").resolves.toBeNull();
      await expect(comoWebhook(`UPDATE "Usuario" SET activo = true WHERE id = $1`, [inactivo.id]), "reactivar").resolves.toBe("BG710");
      await expect(comoWebhook(`UPDATE "Usuario" SET rol = 'SUPERADMIN' WHERE id = $1`, [u.id]), "rol").resolves.toBe("BG710");
      await expect(comoWebhook(`UPDATE "Usuario" SET "clerkUserId" = 'user_x' WHERE id = $1`, [u.id]), "clerkUserId").resolves.toBe("BG709");
      await expect(
        comoWebhook(`INSERT INTO "Usuario" (id, "clerkUserId", correo, rol, "updatedAt") VALUES (uuid_generate_v7(), $1, $2, 'COMPRAS', now())`, [
          `user_${randomUUID()}`, `${randomUUID()}@prueba.test`,
        ]),
        "crear",
      ).resolves.toBe("BG710");
      // Con otro origen declarado no pasa nada.
      await expect(
        intentar(app, async () => {
          await app.query("SELECT set_config('app.origen', 'arranque', true)");
          await app.query(`UPDATE "Usuario" SET correo = 'x@prueba.test' WHERE id = $1`, [u.id]);
        }),
      ).resolves.toBe("BG706");
    });
  });

  it("un UPDATE que solo toca updatedAt también exige actor, y con liga no deja ruido en la bitácora", async () => {
    const bodega = await prisma.bodega.create({ data: { nombre: `Sin cambios ${randomUUID()}` } });
    const soloFecha = () => app.query(`UPDATE "Bodega" SET "updatedAt" = now() WHERE id = $1`, [bodega.id]);
    await expect(intentar(app, soloFecha), "solo updatedAt, sin liga").resolves.toBe("BG706");
    await expect(intentar(app, () => app.query(`UPDATE "Bodega" SET nombre = nombre WHERE id = $1`, [bodega.id])), "sin cambios, sin liga").resolves.toBe("BG706");

    const antes = await prisma.bitacora.count({ where: { registroId: bodega.id } });
    await app.query("BEGIN");
    await ligar(app, await tokenDe(e.usuarios.COMPRAS.id));
    await soloFecha();
    await app.query("COMMIT");
    await expect(prisma.bitacora.count({ where: { registroId: bodega.id } })).resolves.toBe(antes);
  });

  describe("la facultad de autorizar se lee bajo candado", () => {
    const autorizar = (id: string, autorizador: string) =>
      app.query(`UPDATE "Movimiento" SET estatus = 'AUTORIZADA', "autorizadoPorId" = $2, "autorizadoEn" = now() WHERE id = $1`, [id, autorizador]);

    it("una revocación posterior espera a que confirme la autorización en curso", async () => {
      const autorizador = await usuarioNuevo({ rol: "JEFE", puedeAutorizar: true });
      const m = await salidaSolicitada();
      await app.query("BEGIN");
      try {
        await ligar(app, await tokenDe(autorizador.id));
        await autorizar(m.id, autorizador.id);
        const revocacion = desenlace(prisma.usuario.update({ where: { id: autorizador.id }, data: { puedeAutorizar: false } }));
        await bloqueadaPor(dueno, app.pid);
        await app.query("COMMIT");
        await expect(revocacion).resolves.toMatchObject({ ok: true });
      } catch (error) {
        await app.query("ROLLBACK");
        throw error;
      }
      await expect(prisma.movimiento.findUniqueOrThrow({ where: { id: m.id } })).resolves.toMatchObject({ estatus: "AUTORIZADA", autorizadoPorId: autorizador.id });
    });

    it("una revocación en curso se espera y se lee: sin la bandera, la autorización se rechaza", async () => {
      const autorizador = await usuarioNuevo({ rol: "JEFE", puedeAutorizar: true });
      const m = await salidaSolicitada();
      const revocador = await conexion(URL_PRUEBAS);
      try {
        await revocador.query("BEGIN");
        await revocador.query(`UPDATE "Usuario" SET "puedeAutorizar" = false WHERE id = $1`, [autorizador.id]);
        await app.query("BEGIN");
        await ligar(app, await tokenDe(autorizador.id));
        const intento = desenlace(autorizar(m.id, autorizador.id));
        await bloqueadaPor(dueno, revocador.pid);
        await revocador.query("COMMIT");
        const r = await intento;
        expect(r.ok ? null : (r.error as { code?: string }).code).toBe("23514");
      } finally {
        await app.query("ROLLBACK");
        await revocador.end();
      }
      await expect(prisma.movimiento.findUniqueOrThrow({ where: { id: m.id } })).resolves.toMatchObject({ estatus: "SOLICITADA", autorizadoPorId: null });
    });
  });

  describe("la guarda de Usuario lee al superadmin bajo candado", () => {
    it("una revocación posterior espera a que confirme el cambio en curso", async () => {
      const superadmin = await usuarioNuevo({ rol: "SUPERADMIN" });
      const objetivo = await usuarioNuevo({ rol: "COMPRAS" });
      await app.query("BEGIN");
      try {
        await ligar(app, await tokenDe(superadmin.id));
        await app.query(`UPDATE "Usuario" SET rol = 'JEFE' WHERE id = $1`, [objetivo.id]);
        const revocacion = desenlace(prisma.usuario.update({ where: { id: superadmin.id }, data: { rol: "COMPRAS" } }));
        await bloqueadaPor(dueno, app.pid);
        await app.query("COMMIT");
        await expect(revocacion).resolves.toMatchObject({ ok: true });
      } catch (error) {
        await app.query("ROLLBACK");
        throw error;
      }
      await expect(prisma.usuario.findUniqueOrThrow({ where: { id: objetivo.id } })).resolves.toMatchObject({ rol: "JEFE" });
    });

    it("una revocación en curso se espera y se lee: sin rol de superadmin, el cambio se rechaza", async () => {
      const superadmin = await usuarioNuevo({ rol: "SUPERADMIN" });
      const objetivo = await usuarioNuevo({ rol: "COMPRAS" });
      const revocador = await conexion(URL_PRUEBAS);
      try {
        await revocador.query("BEGIN");
        await revocador.query(`UPDATE "Usuario" SET rol = 'COMPRAS' WHERE id = $1`, [superadmin.id]);
        await app.query("BEGIN");
        await ligar(app, await tokenDe(superadmin.id));
        const cambio = desenlace(app.query(`UPDATE "Usuario" SET rol = 'JEFE' WHERE id = $1`, [objetivo.id]));
        await bloqueadaPor(dueno, revocador.pid);
        await revocador.query("COMMIT");
        const r = await cambio;
        expect(r.ok ? null : (r.error as { code?: string }).code).toBe("BG708");
      } finally {
        await app.query("ROLLBACK");
        await revocador.end();
      }
      await expect(prisma.usuario.findUniqueOrThrow({ where: { id: objetivo.id } })).resolves.toMatchObject({ rol: "COMPRAS" });
    });
  });

  it("las tablas sin bitácora tampoco se escriben sin actor; EventoWebhook admite al webhook", async () => {
    await expect(intentar(app, () => app.query(`UPDATE "Folio" SET siguiente = siguiente WHERE tipo = 'SALIDA'`)), "Folio sin liga").resolves.toBe("BG706");
    await expect(intentar(app, () => app.query(`DELETE FROM "Existencia" WHERE false`)), "Existencia sin liga").resolves.toBe("BG706");
    await expect(intentar(app, () => app.query(`DELETE FROM "ConsumoCapa" WHERE false`)), "ConsumoCapa sin liga").resolves.toBe("BG706");
    await expect(
      intentar(app, async () => {
        await ligar(app, await tokenDe(e.usuarios.COMPRAS.id));
        await app.query(`UPDATE "Folio" SET siguiente = siguiente WHERE tipo = 'SALIDA'`);
      }),
      "Folio con liga",
    ).resolves.toBeNull();
    const evento = () =>
      app.query(`INSERT INTO "EventoWebhook" ("eventoId", tipo, payload) VALUES ($1, 'user.updated', '{}')`, [`msg_${randomUUID()}`]);
    await expect(intentar(app, evento), "EventoWebhook sin origen").resolves.toBe("BG706");
    await expect(
      intentar(app, async () => {
        await app.query("SELECT set_config('app.origen', 'clerk-webhook', true)");
        await evento();
      }),
      "EventoWebhook del webhook",
    ).resolves.toBeNull();
  });

  describe("registros de acceso", () => {
    const denegado = (token: string) =>
      app.query<{ r: boolean }>("SELECT seguridad.registrar_acceso_denegado($1, '10.0.0.1', 'prueba') AS r", [token]).then((r) => r.rows[0].r);

    it("solo registra un acceso denegado de verdad, uno cada 15 minutos por identidad", async () => {
      const activo = await usuarioNuevo({ rol: "COMPRAS" });
      await expect(codigoDe(denegado(await tokenDe(activo.id))), "usuario activo").resolves.toBe("BG711");

      const sinCuenta = `user_sin_cuenta_${randomUUID().slice(0, 8)}`;
      await expect(denegado(firmarToken(llave, sinCuenta))).resolves.toBe(true);
      await expect(denegado(firmarToken(llave, sinCuenta)), "repetido").resolves.toBe(false);
      await expect(prisma.eventoAcceso.findMany({ where: { clerkUserId: sinCuenta } })).resolves.toMatchObject([
        { tipo: "ACCESO_DENEGADO", usuarioId: null, ip: "10.0.0.1", agente: "prueba" },
      ]);

      const baja = await usuarioNuevo({ rol: "COMPRAS", activo: false });
      await expect(denegado(await tokenDe(baja.id))).resolves.toBe(true);
      await expect(prisma.eventoAcceso.findFirstOrThrow({ where: { clerkUserId: baja.clerkUserId } })).resolves.toMatchObject({ usuarioId: baja.id });
    });

    it("rechaza un token ajeno o vencido, y nadie inserta accesos directamente", async () => {
      const ajena = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const ajeno = firmarToken(llave, "user_ajeno", { firma: (c) => createSign("RSA-SHA256").update(c).sign(ajena.privateKey).toString("base64url") });
      await expect(codigoDe(denegado(ajeno)), "ajeno").resolves.toBe("BG701");
      const ahora = Math.floor(Date.now() / 1000);
      await expect(codigoDe(denegado(firmarToken(llave, "user_x", { carga: { iat: ahora - 90, nbf: ahora - 90, exp: ahora - 30 } }))), "vencido").resolves.toBe("BG701");
      await expect(
        intentar(app, () => app.query(`INSERT INTO "EventoAcceso" (id, "clerkUserId", tipo) VALUES (gen_random_uuid(), 'user_x', 'ACCESO_DENEGADO')`)),
      ).resolves.toBe("42501");
    });

    it("los eventos de sesión solo entran por el webhook y para usuarios del sistema", async () => {
      const sesion = (tipo: string, clerk: string) =>
        app.query<{ r: boolean }>("SELECT seguridad.registrar_evento_de_sesion($1, $2, null, null) AS r", [clerk, tipo]).then((r) => r.rows[0].r);
      const clerk = await clerkDe(e.usuarios.COMPRAS.id);
      await expect(intentar(app, () => sesion("SESION_INICIADA", clerk)), "sin origen").resolves.toBe("BG710");
      const comoWebhook = (paso: () => Promise<unknown>) =>
        intentar(app, async () => {
          await app.query("SELECT set_config('app.origen', 'clerk-webhook', true)");
          await paso();
        });
      await expect(comoWebhook(() => sesion("ACCESO_DENEGADO", clerk)), "tipo ajeno").resolves.toBe("BG710");
      await expect(comoWebhook(async () => expect(await sesion("SESION_INICIADA", clerk)).toBe(true))).resolves.toBeNull();
      await expect(comoWebhook(async () => expect(await sesion("SESION_INICIADA", "user_sin_fila")).toBe(false))).resolves.toBeNull();
    });
  });
});

// ─────────────────────────────── Fase A ──────────────────────────────────────

describe("fase A", () => {
  const MIGRACIONES = join(RAIZ, "prisma/migrations");
  const migracion = (nombre: string) => readFileSync(join(MIGRACIONES, nombre, "migration.sql"), "utf8");
  const despues = (archivo: string) => readFileSync(join(RAIZ, "prisma/sql/despues", archivo), "utf8");

  it("las migraciones son copia fiel de prisma/sql/despues", () => {
    expect(migracion("20260925100000_actor_verificable")).toContain(despues("95-actor-verificable.sql"));
    expect(migracion("20260925110000_actor_exigido")).toBe(despues("96-actor-exigido.sql"));
    expect(migracion("20260927100000_vida_token")).toBe(despues("97-vida-token.sql"));
    expect(migracion("20260927120000_correcciones_actor")).toBe(despues("98-correcciones-actor.sql"));
    expect(migracion("20260927130000_facultad_bajo_candado")).toBe(despues("99-facultad-bajo-candado.sql"));
  });

  it("una escritura sin liga queda marcada como heredada, y no se puede falsear insertando en la bitácora", async () => {
    // La función de la fase A tal como la despliega su migración; al terminar
    // se restaura exactamente la que había.
    const sql = migracion("20260925100000_actor_verificable");
    const inicio = sql.indexOf("CREATE FUNCTION seguridad.actor_de_la_escritura");
    const faseA = sql.slice(inicio, sql.indexOf("END $$;", inicio) + "END $$;".length).replace(/^CREATE FUNCTION/, "CREATE OR REPLACE FUNCTION");
    const { rows: vigente } = await dueno.query<{ def: string }>(
      "SELECT pg_get_functiondef('seguridad.actor_de_la_escritura(text, text)'::regprocedure) AS def",
    );
    await dueno.query(faseA);
    try {
      const u = e.usuarios.COMPRAS;
      await app.query("BEGIN");
      await app.query("SELECT set_config('app.usuario_id', $1, true)", [u.id]);
      const { rows } = await app.query(`INSERT INTO "Bodega" (id, nombre, "updatedAt") VALUES (uuid_generate_v7(), $1, now()) RETURNING id`, [`Heredada ${randomUUID()}`]);
      await app.query("COMMIT");
      await expect(prisma.bitacora.findFirstOrThrow({ where: { registroId: rows[0].id } })).resolves.toMatchObject({
        usuarioId: u.id, verificacion: "heredada", jti: null,
      });
      await expect(
        intentar(app, () =>
          app.query(`INSERT INTO "Bitacora" (id, tabla, "registroId", accion, verificacion) VALUES (gen_random_uuid(), 'Bodega', 'x', 'INSERTAR', 'liga')`),
        ),
      ).resolves.toBe("42501");
    } finally {
      await dueno.query(vigente[0].def);
    }
  });
});
