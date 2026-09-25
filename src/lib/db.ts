import "server-only";
import { auth } from "@clerk/nextjs/server";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient, type Rol } from "@prisma/client";
import { headers } from "next/headers";
import { cache } from "react";
import { usuarioTienePermiso, type Permiso, type SujetoDePermisos } from "@/lib/permisos";

// Prisma 7 exige un driver adapter explícito.
const createPrismaClient = () =>
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

// En desarrollo Next.js recarga los módulos en caliente; sin este singleton se
// abriría una conexión nueva en cada recarga hasta agotar el pool de PostgreSQL.
const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof createPrismaClient>;
};

// Deliberadamente SIN export (01 §4.1). La capa de aplicación no puede tomar
// el cliente: solo `consultar()` para leer y `accionProtegida()` para escribir.
// No es una regla que haya que recordar — es que no hay a qué llamarle.
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

/**
 * Tres estados, no dos. `null` mezclaría a quien no inició sesión con quien sí
 * la tiene en Clerk pero no tiene acceso aquí, y son casos distintos: al
 * primero se le manda a entrar, al segundo se le explica y se le registra.
 *
 * `usuarioId` distingue además las dos formas de no tener acceso: nunca te
 * dieron de alta (nulo) o te desactivaron (el id de tu fila). `EventoAcceso`
 * espera justo esa distinción.
 */
export type Sesion =
  | { estado: "sin-sesion" }
  | { estado: "sin-acceso"; clerkUserId: string; usuarioId: string | null }
  | { estado: "activa"; usuario: UsuarioSesion };

/**
 * Quién pregunta y qué puede, leído de PostgreSQL en cada petición.
 *
 * El `cache()` de React memoriza por petición: el tablero hace once consultas
 * y todas comparten una sola lectura de `Usuario`, en vez de arrastrar once.
 *
 * No registra nada a propósito. Si escribiera, reventaría al ser llamada desde
 * `consultar()`, cuya transacción es de solo lectura. El registro del acceso
 * denegado vive en el layout, que es quien decide a dónde mandar a la persona.
 */
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

/**
 * La sesión se leyó antes de abrir la transacción. Antes de confirmar se
 * relee el usuario bajo FOR SHARE: una revocación ya confirmada revierte la
 * acción entera, y una posterior espera a este commit.
 *
 * Va al final y no al principio para no sostener el candado mientras la
 * acción toma los suyos: la administración de usuarios bloquea a todos los
 * superadmins, y dos superadmins con su propia fila tomada se esperarían
 * entre sí.
 */
async function exigirVigente(tx: Prisma.TransactionClient, id: string, permiso: Permiso): Promise<void> {
  const [usuario] = await tx.$queryRaw<Vigencia[]>`
    SELECT rol, "puedeAutorizar", activo FROM "Usuario" WHERE id = ${id}::uuid FOR SHARE`;
  const error = negativa(usuario, permiso);
  if (error) throw error;
}

// ──────────────────── Las dos puertas de la aplicación ───────────────────────

/**
 * Leer. El callback corre dentro de una transacción `REPEATABLE READ READ ONLY`.
 *
 * Las dos mitades hacen falta y hacen cosas distintas:
 *
 *   · READ ONLY hace que PostgreSQL rechace cualquier escritura. Sin él esto
 *     sería una convención: `Prisma.TransactionClient` tiene `create`, y
 *     TypeScript no lo impediría.
 *   · REPEATABLE READ da la instantánea consistente. En READ COMMITTED —el
 *     modo por omisión— cada sentencia toma su propia instantánea, así que
 *     dos consultas de la misma pantalla pueden ver estados distintos.
 *
 * Una transacción de solo lectura no puede tener conflictos de escritura, así
 * que REPEATABLE READ no introduce aquí el fallo de serialización que suele
 * acompañarlo.
 */
export async function consultar<T>(
  permiso: Permiso,
  fn: (db: Prisma.TransactionClient, usuario: UsuarioSesion) => Promise<T>,
): Promise<T> {
  const usuario = await exigir(permiso);

  return prisma.$transaction(
    async (tx) => {
      // Tiene que ser la primera sentencia de la transacción.
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      return fn(tx, usuario);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

/**
 * Escribir. Único camino de escritura de la capa de aplicación (01 §4.1).
 *
 * Converge lo que de otro modo habría que recordar por separado: lee la
 * sesión, verifica el permiso, abre la transacción y fija `app.usuario_id`,
 * que es lo que el trigger de bitácora está esperando para no anotar la
 * escritura como «escritura-directa». Antes de confirmar vuelve a exigir el
 * permiso dentro de la transacción (exigirVigente). `fn` no debe tener
 * efectos fuera de la transacción: si el permiso ya no está, todo se revierte.
 *
 * El permiso puede ser fijo o derivarse de los argumentos: `guardarCatalogo`
 * necesita lo segundo, porque escribir Empresa no exige lo mismo que escribir
 * Bodega y eso lo dice la definición del catálogo, no la acción.
 */
export function accionProtegida<Args extends unknown[], T>(
  // El resolvedor recibe los argumentos como tupla, no como lista, y va
  // envuelto en `NoInfer`: así los tipos salen solo de `fn`. Sin las dos cosas,
  // un resolvedor que mira el primer argumento haría creer a TypeScript que la
  // acción entera recibe uno.
  permiso: Permiso | ((args: NoInfer<Args>) => Permiso),
  fn: (tx: Prisma.TransactionClient, usuario: UsuarioSesion, ...args: Args) => Promise<T>,
): (...args: Args) => Promise<T> {
  return async (...args: Args) => {
    const requerido = typeof permiso === "function" ? permiso(args) : permiso;
    const usuario = await exigir(requerido);

    try {
      return await prisma.$transaction(async (tx) => {
        // set_config con is_local = true equivale a SET LOCAL, pero admite
        // parámetro en vez de interpolar el id dentro del SQL.
        await tx.$executeRaw`SELECT set_config('app.usuario_id', ${usuario.id}, true)`;
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
      throw negativa(ahora, requerido, error) ?? error;
    }
  };
}

// ─────────────────── La tercera puerta: procesos sin sesión ──────────────────

/**
 * Quién escribe cuando no hay nadie. El tipo es cerrado a propósito: un origen
 * nuevo se declara aquí, no se inventa en la línea que lo usa, y así la
 * bitácora nunca guarda una etiqueta que no signifique nada.
 */
type OrigenSistema = "clerk-webhook";

/**
 * Un cliente recortado, no el completo.
 *
 * 01 §4.1 dice que el webhook «solo puede escribir tres tablas». Escrito como
 * comentario sería una convención; escrito como tipo, tocar `Movimiento` desde
 * el webhook no compila. Es el mismo criterio que el READ ONLY de consultar().
 */
export type ClienteWebhook = Pick<
  Prisma.TransactionClient,
  "eventoWebhook" | "usuario" | "eventoAcceso"
>;

/**
 * La segunda puerta de 01 §4.1: llega de fuera, sin sesión, y escribe.
 *
 * No puede pasar por `accionProtegida` porque no hay usuario a quien pedirle
 * permiso. Lo que sí hace es declararse: fija `app.origen` en vez de
 * `app.usuario_id`, así que el trigger de bitácora anota quién escribió y
 * nada acaba como «escritura-directa».
 *
 * Todo el callback corre dentro de una sola transacción. Es deliberado y lo
 * exige el diseño de `EventoWebhook`: la entrega se registra, el cambio se
 * aplica y se marca como procesada, o no ocurre nada de eso. A medias no.
 */
export async function escrituraDeSistema<T>(
  origen: OrigenSistema,
  fn: (db: ClienteWebhook) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.origen', ${origen}, true)`;
    return fn(tx);
  });
}

/**
 * Deja constancia de que alguien con sesión válida en Clerk tocó la puerta sin
 * poder entrar. Vive aquí y no en el layout porque escribe, y el cliente ya no
 * sale de este módulo.
 *
 * Es la única escritura que no pasa por `accionProtegida`, y no puede pasar:
 * por definición la dispara quien no tiene permiso de nada. Por eso escribe una
 * sola tabla, de registro, y nada más. La bitácora no la alcanza a propósito
 * —`EventoAcceso` no lleva trigger: son registros, no datos—.
 *
 * Se limita a un renglón cada quince minutos por identidad: sin eso, quien
 * recarga veinte veces deja veinte renglones y vuelve inútil la tabla justo
 * cuando haya que consultarla.
 */
export async function registrarAccesoDenegado(clerkUserId: string, usuarioId: string | null) {
  const reciente = await prisma.eventoAcceso.findFirst({
    where: {
      clerkUserId,
      tipo: "ACCESO_DENEGADO",
      ocurridoEn: { gte: new Date(Date.now() - 15 * 60 * 1000) },
    },
    select: { id: true },
  });

  if (reciente) return;

  const cabeceras = await headers();
  await prisma.eventoAcceso.create({
    data: {
      clerkUserId,
      usuarioId,
      tipo: "ACCESO_DENEGADO",
      ip: cabeceras.get("x-forwarded-for") ?? undefined,
      agente: cabeceras.get("user-agent") ?? undefined,
    },
  });
}
