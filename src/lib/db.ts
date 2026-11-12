import "server-only";
import { auth } from "@clerk/nextjs/server";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient, type Rol } from "@prisma/client";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import {
  arrendarLote,
  bloquearLote,
  leerDestinatarios,
  leerExistenciasBajoMinimo,
  type Destinatario,
  type LoteArrendado,
  type LoteBloqueado,
} from "@/lib/correo/consultas";

export type { LoteArrendado, LoteBloqueado } from "@/lib/correo/consultas";
import { detalleDePostgres, esErrorDePrisma } from "@/lib/movimientos/errores";
import { usuarioTienePermiso, type Permiso, type SujetoDePermisos } from "@/lib/permisos";
import type { ExistenciasBajoMinimo } from "@/lib/reportes/existencias";

const createPrismaClient = () =>
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, options: "-c TimeZone=UTC" }),
  });

const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof createPrismaClient>;
};

const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// ─────────────────────────────── La sesión ───────────────────────────────────

export type UsuarioSesion = {
  id: string;
  rol: Rol;
  puedeAutorizar: boolean;
};

export type Sesion =
  | { estado: "sin-sesion" }
  | { estado: "sin-acceso"; clerkUserId: string; usuarioId: string | null }
  | { estado: "activa"; usuario: UsuarioSesion };

export const sesionActual = cache(async (): Promise<Sesion> => {
  const { userId } = await auth();
  if (!userId) return { estado: "sin-sesion" };

  const usuario = await prisma.usuario.findUnique({
    where: { clerkUserId: userId },
    select: { id: true, rol: true, puedeAutorizar: true, activo: true },
  });

  if (!usuario) return { estado: "sin-acceso", clerkUserId: userId, usuarioId: null };
  if (!usuario.activo) {
    return { estado: "sin-acceso", clerkUserId: userId, usuarioId: usuario.id };
  }

  return {
    estado: "activa",
    usuario: { id: usuario.id, rol: usuario.rol, puedeAutorizar: usuario.puedeAutorizar },
  };
});

export class SinAcceso extends Error {
  constructor(opciones?: ErrorOptions) {
    super("Sin acceso: la sesión no tiene un usuario activo en el sistema.", opciones);
    this.name = "SinAcceso";
  }
}

export class IdentidadNoVerificable extends Error {
  constructor(motivo: string, opciones?: ErrorOptions) {
    super(`No se pudo verificar la identidad: ${motivo}`, opciones);
    this.name = "IdentidadNoVerificable";
  }
}

export class SinPermiso extends Error {
  constructor(
    readonly permiso: Permiso,
    opciones?: ErrorOptions,
  ) {
    super(`Sin permiso: se requiere ${permiso}.`, opciones);
    this.name = "SinPermiso";
  }
}

async function exigir(permiso: Permiso): Promise<UsuarioSesion> {
  const sesion = await sesionActual();
  if (sesion.estado !== "activa") throw new SinAcceso();
  if (!usuarioTienePermiso(sesion.usuario, permiso)) throw new SinPermiso(permiso);
  return sesion.usuario;
}

type Vigencia = (SujetoDePermisos & { activo: boolean }) | null | undefined;

/** La negativa que corresponde a como está el usuario ahora; null si conserva el permiso. */
function negativa(usuario: Vigencia, permiso: Permiso, causa?: unknown): SinAcceso | SinPermiso | null {
  const opciones = causa === undefined ? undefined : { cause: causa };
  if (!usuario?.activo) return new SinAcceso(opciones);
  if (!usuarioTienePermiso(usuario, permiso)) return new SinPermiso(permiso, opciones);
  return null;
}

// ─────────────────────── El actor, verificado por la base ────────────────────

/** La plantilla JWT de Clerk que verifica seguridad.fijar_actor(). */
const PLANTILLA_DE_ACTOR = "bodegasosur-db";

/** Un token nuevo por escritura. Es una petición a Clerk: va fuera de la transacción. */
async function tokenDeActor(): Promise<string> {
  const { getToken } = await auth();
  const token = await getToken({ template: PLANTILLA_DE_ACTOR });
  if (!token) throw new SinAcceso();
  return token;
}

/** Las llaves públicas cargadas, por emisor: identificadores públicos, para la alerta de rotación. */
export async function kidsCargados(): Promise<{ kid: string; emisor: string }[]> {
  return prisma.$queryRaw<{ kid: string; emisor: string }[]>`SELECT kid, emisor FROM seguridad.kids_cargados()`;
}

/**
 * Traduce lo que rechazan las funciones de `seguridad`. Una llave sin cargar
 * deja una línea propia en el log: es la alerta de que Clerk rotó su llave.
 */
function rechazoDeIdentidad(error: unknown): Error | null {
  if (!esErrorDePrisma(error)) return null;
  const detalle = detalleDePostgres(error);
  if (!detalle?.sqlstate.startsWith("BG70")) return null;
  if (detalle.sqlstate === "BG705") return new SinAcceso({ cause: error });
  if (detalle.sqlstate === "BG702") {
    console.error(`[seguridad] kid desconocido: ${detalle.mensaje} Carga la llave con npm run db:llaves-clerk.`);
  } else {
    console.error(`[seguridad] token rechazado (${detalle.sqlstate}): ${detalle.mensaje}`);
  }
  return new IdentidadNoVerificable(detalle.mensaje, { cause: error });
}

async function exigirVigente(tx: Prisma.TransactionClient, id: string, permiso: Permiso): Promise<void> {
  const [usuario] = await tx.$queryRaw<Vigencia[]>`
    SELECT rol, "puedeAutorizar", activo FROM "Usuario" WHERE id = ${id}::uuid FOR SHARE`;
  const error = negativa(usuario, permiso);
  if (error) throw error;
}

export async function comprobarPermiso(permiso: Permiso): Promise<UsuarioSesion> {
  return exigir(permiso);
}

// ──────────────────── Las dos puertas de la aplicación ───────────────────────

export async function consultar<T>(
  permiso: Permiso,
  fn: (db: Prisma.TransactionClient, usuario: UsuarioSesion) => Promise<T>,
): Promise<T> {
  if ((await sesionActual()).estado === "sin-sesion") redirect("/sign-in");
  return consultarDesdeAccion(permiso, fn);
}

/** `consultar()` para una Server Action: sin sesión lanza SinAcceso y la acción decide qué responder. */
export async function consultarDesdeAccion<T>(
  permiso: Permiso,
  fn: (db: Prisma.TransactionClient, usuario: UsuarioSesion) => Promise<T>,
): Promise<T> {
  return leer(permiso, fn);
}

/** La sesión según Clerk, sin leer la base: para contar intentos antes de consultar. */
export async function identidadDeSesion(): Promise<string | null> {
  return (await auth()).userId;
}

/** Quién descarga, antes de leer, para limitar por usuario. Lanza SinAcceso o SinPermiso. */
export function usuarioParaDescarga(permiso: Permiso): Promise<UsuarioSesion> {
  return exigir(permiso);
}

export async function consultarParaDescarga<T>(
  permiso: Permiso,
  fn: (db: Prisma.TransactionClient, usuario: UsuarioSesion) => Promise<T>,
): Promise<T> {
  return leer(permiso, fn, 60_000);
}

async function leer<T>(permiso: Permiso, fn: (db: Prisma.TransactionClient, usuario: UsuarioSesion) => Promise<T>, timeout?: number): Promise<T> {
  const usuario = await exigir(permiso);

  return prisma.$transaction(
    async (tx) => {
      // Tiene que ser la primera sentencia de la transacción.
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      return fn(tx, usuario);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout },
  );
}

export function accionProtegida<Args extends unknown[], T>(
  permiso: Permiso | ((args: NoInfer<Args>) => Permiso),
  fn: (tx: Prisma.TransactionClient, usuario: UsuarioSesion, ...args: Args) => Promise<T>,
): (...args: Args) => Promise<T> {
  return async (...args: Args) => {
    const requerido = typeof permiso === "function" ? permiso(args) : permiso;
    const usuario = await exigir(requerido);
    const token = await tokenDeActor();

    try {
      return await prisma.$transaction(async (tx) => {
        // Primera sentencia: sin liga, la base rechaza toda escritura.
        const [{ actor }] = await tx.$queryRaw<{ actor: string }[]>`SELECT seguridad.fijar_actor(${token}) AS actor`;
        if (actor !== usuario.id) throw new SinAcceso();
        const resultado = await fn(tx, usuario, ...args);
        await exigirVigente(tx, usuario.id, requerido);
        return resultado;
      });
    } catch (error) {
      if (error instanceof SinAcceso || error instanceof SinPermiso) throw error;
      // Falló antes de llegar a exigirVigente (un trigger que ya vio la
      // revocación, por ejemplo): si el permiso ya no está, se responde con la
      // negativa y no con el síntoma.
      const ahora = await prisma.usuario.findUnique({
        where: { id: usuario.id },
        select: { rol: true, puedeAutorizar: true, activo: true },
      });
      throw negativa(ahora, requerido, error) ?? rechazoDeIdentidad(error) ?? error;
    }
  };
}

// ─────────────────── La tercera puerta: procesos sin sesión ──────────────────

type OrigenSistema = "clerk-webhook" | "resumen-diario" | "resend-webhook";

export type ClienteWebhook = Pick<Prisma.TransactionClient, "eventoWebhook" | "usuario"> & {
  registrarEventoDeSesion(evento: {
    clerkUserId: string;
    tipo: "SESION_INICIADA" | "SESION_TERMINADA" | "SESION_REMOVIDA" | "SESION_REVOCADA";
    ip: string | null;
    agente: string | null;
  }): Promise<void>;
};

export type ClienteResumenDiario = Pick<Prisma.TransactionClient, "evaluacionCorreos" | "loteCorreos" | "registroCorreos"> & {
  candadoDelDia(fecha: Date): Promise<void>;
  leerExistenciasBajoMinimo(tope: number): Promise<ExistenciasBajoMinimo>;
  leerDestinatarios(): Promise<Destinatario[]>;
  arrendarLote(loteId: string, fecha: Date): Promise<LoteArrendado | null>;
  bloquearLote(loteId: string): Promise<LoteBloqueado | null>;
};

/** El webhook de Resend: inserta eventos y concilia lotes y registros. */
export type ClienteResendWebhook = Pick<Prisma.TransactionClient, "eventoCorreo" | "loteCorreos" | "registroCorreos"> & {
  bloquearLote(loteId: string): Promise<LoteBloqueado | null>;
};

type ClientesDeSistema = {
  "clerk-webhook": ClienteWebhook;
  "resumen-diario": ClienteResumenDiario;
  "resend-webhook": ClienteResendWebhook;
};

function clienteDeSistema(origen: OrigenSistema, tx: Prisma.TransactionClient): ClientesDeSistema[OrigenSistema] {
  switch (origen) {
    case "clerk-webhook":
      return {
        eventoWebhook: tx.eventoWebhook,
        usuario: tx.usuario,
        async registrarEventoDeSesion({ clerkUserId, tipo, ip, agente }) {
          await tx.$queryRaw`SELECT seguridad.registrar_evento_de_sesion(${clerkUserId}, ${tipo}, ${ip}, ${agente})`;
        },
      } satisfies ClienteWebhook;
    case "resumen-diario":
      return {
        evaluacionCorreos: tx.evaluacionCorreos,
        loteCorreos: tx.loteCorreos,
        registroCorreos: tx.registroCorreos,
        async candadoDelDia(fecha) {
          await tx.$executeRaw`SELECT candado_correos_del_dia(${fecha}::date)`;
        },
        leerExistenciasBajoMinimo: (tope) => leerExistenciasBajoMinimo(tx, tope),
        leerDestinatarios: () => leerDestinatarios(tx),
        arrendarLote: (loteId, fecha) => arrendarLote(tx, loteId, fecha),
        bloquearLote: (loteId) => bloquearLote(tx, loteId),
      } satisfies ClienteResumenDiario;
    case "resend-webhook":
      return {
        eventoCorreo: tx.eventoCorreo,
        loteCorreos: tx.loteCorreos,
        registroCorreos: tx.registroCorreos,
        bloquearLote: (loteId) => bloquearLote(tx, loteId),
      } satisfies ClienteResendWebhook;
  }
}

export async function escrituraDeSistema<O extends OrigenSistema, T>(
  origen: O,
  fn: (db: ClientesDeSistema[O]) => Promise<T>,
  opciones?: { isolationLevel?: Prisma.TransactionIsolationLevel; timeout?: number; maxWait?: number },
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.origen', ${origen}, true)`;
    // Con tope de tiempo, ninguna sentencia ni espera de candado lo rebasa dentro de la base
    if (opciones?.timeout) {
      const tope = `${opciones.timeout}ms`;
      await tx.$executeRaw`SELECT set_config('statement_timeout', ${tope}, true), set_config('lock_timeout', ${tope}, true)`;
    }
    return fn(clienteDeSistema(origen, tx) as ClientesDeSistema[O]);
  }, opciones);
}

export async function registrarAccesoDenegado() {
  try {
    const token = await tokenDeActor();
    const cabeceras = await headers();
    await prisma.$queryRaw`SELECT seguridad.registrar_acceso_denegado(
      ${token}, ${cabeceras.get("x-forwarded-for")}, ${cabeceras.get("user-agent")})`;
  } catch (error) {
    console.error("[seguridad] no se registró el acceso denegado:", rechazoDeIdentidad(error) ?? error);
  }
}
