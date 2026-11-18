/*
  npm run correo:estados -- <correo de la cuenta de prueba>
*/

import { createInterface } from "node:readline/promises";
import type { ClaseRebote } from "@prisma/client";
import type { CausaDeExclusion } from "../src/lib/correo/exclusion";
import type { EstadoDelAviso } from "../src/lib/correo/entrega";
import type { AvisoDelDia, MiCuenta } from "../src/lib/cuenta/formulario";
import { aFechaDeBase, formatearFecha, hoyEnMexico, sumarDias } from "../src/lib/fechas";
import { VALOR_DE_AUTORIZACION, VARIABLE_DE_AUTORIZACION, crearClienteDelDueno, esEjecucionDirecta, type Tx } from "../prisma/comun";

// Ids fijos: la limpieza borra exactamente estas filas y nada más
const id = (n: number) => `00000000-e57a-4d05-8000-${String(n).padStart(12, "0")}`;
const LOTE = { anteayer: id(1), ayer: id(2) };
const REGISTRO = { anteayer: id(11), ayer: id(12) };
const EVALUACION = { sinBajoMinimo: id(21), sinDestinatarios: id(22) };
const EVENTO = { demora: id(31), entrega: id(32), supresion: id(33), rebote: id(34), queja: id(35) };
export const IDS = {
  eventos: Object.values(EVENTO),
  registros: Object.values(REGISTRO),
  lotes: Object.values(LOTE),
  evaluaciones: Object.values(EVALUACION),
};

const RESEND_ID = "prueba-estados-ayer";

export type Contexto = { usuarioId: string; correo: string; hoy: string; anteayer: string; ayer: string };
export type Esperado = Pick<MiCuenta, "ultimoAviso" | "exclusion" | "avisoDelDia">;
export type Paso = { titulo: string; aplicar: (tx: Tx, c: Contexto) => Promise<unknown>; esperado: (c: Contexto) => Esperado };

// -- Guardia --

const SERVIDORES_LOCALES = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function verificarGuardia(entorno: Record<string, string | undefined> = process.env): void {
  if (entorno[VARIABLE_DE_AUTORIZACION] !== VALOR_DE_AUTORIZACION) {
    throw new Error(`Solo es de desarrollo: falta ${VARIABLE_DE_AUTORIZACION}=${VALOR_DE_AUTORIZACION} en .env.`);
  }
  if (entorno.NODE_ENV === "production") throw new Error("No corre con NODE_ENV=production.");
  const url = entorno.DATABASE_URL_MIGRACIONES;
  if (!url || !SERVIDORES_LOCALES.has(new URL(url).hostname)) {
    throw new Error("Solo corre contra la base local: DATABASE_URL_MIGRACIONES tiene que apuntar a localhost.");
  }
}

/** Valida la cuenta y la base antes de escribir */
export async function prepararContexto(db: Tx, correo: string, hoy: string): Promise<Contexto> {
  const [usuario] = await db.$queryRaw<{ id: string; correo: string; rol: string; alertasCorreo: boolean }[]>`
    SELECT id, btrim(correo) AS correo, rol::text AS rol, "alertasCorreo" FROM "Usuario"
    WHERE activo AND lower(btrim(correo)) = lower(btrim(${correo}))`;
  if (!usuario) throw new Error(`No hay una cuenta activa con el correo ${correo}.`);
  if (usuario.rol === "SUPERADMIN") throw new Error("Usa una cuenta de prueba: los últimos pasos excluyen la dirección hasta la limpieza.");
  if (!usuario.alertasCorreo) throw new Error("Activa la alerta de esa cuenta en Perfil → Preferencias y vuelve a correr el script.");

  const c: Contexto = { usuarioId: usuario.id, correo: usuario.correo, hoy, anteayer: sumarDias(hoy, -2), ayer: sumarDias(hoy, -1) };
  const enUso = { in: [...IDS.eventos, ...IDS.registros, ...IDS.lotes, ...IDS.evaluaciones] };
  const previas =
    (await db.eventoCorreo.count({ where: { id: enUso } })) +
    (await db.registroCorreos.count({ where: { id: enUso } })) +
    (await db.loteCorreos.count({ where: { id: enUso } })) +
    (await db.evaluacionCorreos.count({ where: { id: enUso } }));
  if (previas > 0) throw new Error("Quedaron filas de una corrida anterior: bórralas con npm run correo:borrar-estados.");

  const evaluados = await db.evaluacionCorreos.count({ where: { fecha: { in: [c.anteayer, c.ayer, hoy].map(aFechaDeBase) } } });
  if (evaluados > 0) throw new Error("Hoy, ayer o anteayer ya se evaluaron en esta base: esos días están cerrados.");
  const [{ avisos }] = await db.$queryRaw<{ avisos: number }[]>`
    SELECT count(*)::int AS avisos FROM "RegistroCorreos"
    WHERE "usuarioId" = ${usuario.id}::uuid OR lower(btrim(correo)) = lower(${usuario.correo})`;
  if (avisos > 0) throw new Error("Esa cuenta o su dirección ya tienen avisos en esta base: usa una cuenta sin avisos.");
  return c;
}

// -- Pasos --

async function reservar(tx: Tx, c: Contexto, fecha: string, lote: string, registro: string) {
  await tx.loteCorreos.create({
    data: {
      id: lote,
      fecha: aFechaDeBase(fecha),
      numero: 1,
      llave: `resumen-${fecha}-1`,
      remitente: "BodeGasosur <avisos@bodegasosur.test>",
      asunto: "Prueba de estados",
      html: "<p>Prueba de estados</p>",
      texto: "Prueba de estados",
      articulos: 1,
    },
    select: { id: true },
  });
  await tx.registroCorreos.create({
    data: { id: registro, loteId: lote, posicion: 0, fecha: aFechaDeBase(fecha), usuarioId: c.usuarioId, correo: c.correo },
    select: { id: true },
  });
}

const evento = (tx: Tx, id: string, tipo: string, datos: { rebote?: ClaseRebote; subtipoRebote?: string; tipoSupresion?: string } = {}) =>
  tx.eventoCorreo.create({
    data: { id, svixId: `prueba-estados-${id}`, tipo, resendId: RESEND_ID, registroId: REGISTRO.ayer, ocurridoEn: new Date(), ...datos },
    select: { id: true },
  });

const cambiar = (tx: Tx, id: string, data: { estado: "SIN_CONFIRMAR" | "FALLIDO" | "ENVIADO"; resendId?: string }) =>
  tx.registroCorreos.update({ where: { id }, data, select: { id: true } });

const ver = (fecha: string, estado: EstadoDelAviso, exclusion: CausaDeExclusion | null = null, avisoDelDia: AvisoDelDia | null = null): Esperado => ({
  ultimoAviso: { fecha, estado },
  exclusion,
  avisoDelDia,
});

export const PASOS: Paso[] = [
  {
    titulo: "Anteayer se reservó tu aviso",
    aplicar: (tx, c) => reservar(tx, c, c.anteayer, LOTE.anteayer, REGISTRO.anteayer),
    esperado: (c) => ver(c.anteayer, "EN_PROCESO"),
  },
  {
    titulo: "Resend no confirmó si aceptó el de anteayer",
    aplicar: (tx) => cambiar(tx, REGISTRO.anteayer, { estado: "SIN_CONFIRMAR" }),
    esperado: (c) => ver(c.anteayer, "SIN_CONFIRMAR"),
  },
  {
    titulo: "Ayer se reservó otro aviso",
    aplicar: (tx, c) => reservar(tx, c, c.ayer, LOTE.ayer, REGISTRO.ayer),
    esperado: (c) => ver(c.ayer, "EN_PROCESO"),
  },
  {
    titulo: "Resend rechazó el de ayer",
    aplicar: (tx) => cambiar(tx, REGISTRO.ayer, { estado: "FALLIDO" }),
    esperado: (c) => ver(c.ayer, "NO_SE_ENVIO"),
  },
  {
    titulo: "La conciliación encontró que sí se aceptó",
    aplicar: (tx) => cambiar(tx, REGISTRO.ayer, { estado: "ENVIADO", resendId: RESEND_ID }),
    esperado: (c) => ver(c.ayer, "ACEPTADO"),
  },
  {
    titulo: "Hoy no hubo artículos bajo mínimo",
    aplicar: (tx, c) =>
      tx.evaluacionCorreos.create({
        data: { id: EVALUACION.sinBajoMinimo, fecha: aFechaDeBase(c.hoy), resultado: "SIN_BAJO_MINIMO", articulos: 0, renglones: 0, destinatarios: 0, lotes: 0 },
        select: { id: true },
      }),
    esperado: (c) => ver(c.ayer, "ACEPTADO", null, "SIN_BAJO_MINIMO"),
  },
  {
    // La evaluación solo admite inserciones: se reemplaza
    titulo: "Hoy sí hubo, pero la alerta se preparó antes de que la activaras",
    aplicar: async (tx, c) => {
      await tx.evaluacionCorreos.delete({ where: { id: EVALUACION.sinBajoMinimo }, select: { id: true } });
      await tx.evaluacionCorreos.create({
        data: { id: EVALUACION.sinDestinatarios, fecha: aFechaDeBase(c.hoy), resultado: "SIN_DESTINATARIOS", articulos: 3, renglones: 4, destinatarios: 0, lotes: 0 },
        select: { id: true },
      });
    },
    esperado: (c) => ver(c.ayer, "ACEPTADO", null, "EMPIEZA_MANIANA"),
  },
  {
    titulo: "Resend avisó que la entrega del de ayer se demora",
    aplicar: (tx) => evento(tx, EVENTO.demora, "email.delivery_delayed"),
    esperado: (c) => ver(c.ayer, "ENTREGA_DEMORADA", null, "EMPIEZA_MANIANA"),
  },
  {
    titulo: "Resend confirmó la entrega",
    aplicar: (tx) => evento(tx, EVENTO.entrega, "email.delivered"),
    esperado: (c) => ver(c.ayer, "ENTREGADO", null, "EMPIEZA_MANIANA"),
  },
  {
    titulo: "Resend puso la dirección en su lista de bloqueo",
    aplicar: (tx) => evento(tx, EVENTO.supresion, "email.suppressed", { tipoSupresion: "OnAccountSuppressionList" }),
    esperado: (c) => ver(c.ayer, "NO_ENTREGADO", "SUPRESION"),
  },
  {
    titulo: "El correo rebotó de forma permanente",
    aplicar: (tx) => evento(tx, EVENTO.rebote, "email.bounced", { rebote: "PERMANENTE", subtipoRebote: "General" }),
    esperado: (c) => ver(c.ayer, "NO_ENTREGADO", "REBOTE"),
  },
  {
    titulo: "El correo se marcó como spam",
    aplicar: (tx) => evento(tx, EVENTO.queja, "email.complained"),
    esperado: (c) => ver(c.ayer, "MARCADO_COMO_SPAM", "QUEJA"),
  },
];

// -- Consola --

// Los mismos textos que preferencias.tsx
const ESTADO: Record<EstadoDelAviso, string> = {
  EN_PROCESO: "En proceso",
  ACEPTADO: "Aceptado por Resend",
  ENTREGA_DEMORADA: "Entrega demorada",
  ENTREGADO: "Entregado",
  NO_ENTREGADO: "No entregado",
  MARCADO_COMO_SPAM: "Marcado como spam",
  NO_SE_ENVIO: "No se envió",
  SIN_CONFIRMAR: "Sin confirmar",
};
const CAUSA: Record<CausaDeExclusion, string> = { QUEJA: "se marcó como spam", REBOTE: "rebotó de forma permanente", SUPRESION: "lista de bloqueo" };
const AVISO: Record<AvisoDelDia, string> = { SIN_BAJO_MINIMO: "«Hoy no hubo artículos bajo mínimo»", EMPIEZA_MANIANA: "«Empieza mañana: …»" };

function describir({ ultimoAviso, exclusion, avisoDelDia }: Esperado): string[] {
  return [
    `Último aviso:  ${ultimoAviso ? `${formatearFecha(ultimoAviso.fecha)} · «${ESTADO[ultimoAviso.estado]}»` : "«Todavía no has recibido ninguno»"}`,
    `Exclusión:     ${exclusion ? `«Tu dirección actual no recibe la alerta» (${CAUSA[exclusion]})` : "sin aviso"}`,
    `Aviso del día: ${avisoDelDia ? AVISO[avisoDelDia] : "sin aviso"}`,
  ];
}

async function main() {
  verificarGuardia();
  const correo = process.argv[2];
  if (!correo) throw new Error("Falta el correo de la cuenta de prueba: npm run correo:estados -- <correo>");

  const prisma = crearClienteDelDueno();
  const consola = createInterface({ input: process.stdin, output: process.stdout });
  consola.on("SIGINT", () => {
    console.log("\nDetenido. Para borrar lo creado: npm run correo:borrar-estados");
    process.exit(130);
  });
  try {
    const c = await prisma.$transaction((tx) => prepararContexto(tx, correo, hoyEnMexico()));
    console.log(`Cuenta: ${c.correo}. Tras cada paso, recarga la página y abre Perfil → Preferencias.\n`);
    for (const [i, paso] of PASOS.entries()) {
      await prisma.$transaction((tx) => paso.aplicar(tx, c));
      console.log(`Paso ${i + 1} de ${PASOS.length}: ${paso.titulo}`);
      for (const linea of describir(paso.esperado(c))) console.log(`  ${linea}`);
      if (i < PASOS.length - 1) await consola.question("\nEnter para el siguiente paso (Ctrl+C para salir)… ");
    }
    console.log("\nListo. Para dejar la base como estaba: npm run correo:borrar-estados");
  } finally {
    consola.close();
    await prisma.$disconnect();
  }
}

if (esEjecucionDirecta(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
