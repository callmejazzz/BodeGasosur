export const ZONA_HORARIA = "America/Mexico_City";

export const FECHA_MINIMA_OPERATIVA = "2000-01-01";

/** Texto `AAAA-MM-DD` que no describe un día real del calendario. */
export class FechaInvalida extends Error {
  constructor(texto: unknown) {
    super(`«${String(texto)}» no es una fecha calendario válida (AAAA-MM-DD).`);
    this.name = "FechaInvalida";
  }
}

const FORMA_CALENDARIO = /^(\d{4})-(\d{2})-(\d{2})$/;

function partesEn(zona: string, instante: Date) {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: zona,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instante);
  const valor = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find((p) => p.type === tipo)?.value ?? "";
  return {
    año: valor("year"),
    mes: valor("month"),
    dia: valor("day"),
    hora: valor("hour"),
    minuto: valor("minute"),
  };
}

// ────────────────────────────── Fechas calendario ────────────────────────────

export function hoyEnMexico(ahora: Date = new Date()): string {
  const { año, mes, dia } = partesEn(ZONA_HORARIA, ahora);
  return `${año}-${mes}-${dia}`;
}

export function esFechaCalendario(texto: unknown): texto is string {
  if (typeof texto !== "string") return false;
  const partes = FORMA_CALENDARIO.exec(texto);
  if (!partes) return false;

  const [, año, mes, dia] = partes.map(Number);
  const fecha = fechaUtc(año, mes, dia);
  return (
    fecha.getUTCFullYear() === año &&
    fecha.getUTCMonth() === mes - 1 &&
    fecha.getUTCDate() === dia
  );
}

export type MotivoFechaNoOperativa = "invalida" | "anterior-a-minima" | "futura";

// FECHA_MINIMA_OPERATIVA ≤ fecha ≤ hoyEnMexico()
export function motivoFechaNoOperativa(texto: unknown, hoy = hoyEnMexico()): MotivoFechaNoOperativa | null {
  if (!esFechaCalendario(texto)) return "invalida";
  if (texto < FECHA_MINIMA_OPERATIVA) return "anterior-a-minima";
  if (texto > hoy) return "futura";
  return null;
}

export function esFechaOperativa(texto: unknown, hoy = hoyEnMexico()): texto is string {
  return motivoFechaNoOperativa(texto, hoy) === null;
}

export function aFechaDeBase(texto: string): Date {
  if (!esFechaCalendario(texto)) throw new FechaInvalida(texto);
  const [, año, mes, dia] = FORMA_CALENDARIO.exec(texto)!.map(Number);
  return fechaUtc(año, mes, dia);
}

export function deFechaDeBase(valor: Date): string {
  const { año, mes, dia } = partesEn("UTC", valor);
  return `${año}-${mes}-${dia}`;
}

// ────────────────────────────────── Formato ──────────────────────────────────

export function formatearFecha(valor: Date | string): string {
  const fecha = typeof valor === "string" ? aFechaDeBase(valor) : valor;
  const { año, mes, dia } = partesEn("UTC", fecha);
  return `${dia}/${mes}/${año}`;
}

export function formatearInstante(valor: Date): string {
  const { año, mes, dia, hora, minuto } = partesEn(ZONA_HORARIA, valor);
  return `${dia}/${mes}/${año} ${hora}:${minuto}`;
}

// ─────────────────────────────────── Interno ─────────────────────────────────

function fechaUtc(año: number, mes: number, dia: number): Date {
  const fecha = new Date(0);
  fecha.setUTCFullYear(año, mes - 1, dia);
  fecha.setUTCHours(0, 0, 0, 0);
  return fecha;
}
