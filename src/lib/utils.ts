import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const formateadorMoneda = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});

const formateadorCantidad = new Intl.NumberFormat("es-MX", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});

/** Prisma entrega los Decimal como objetos; se normalizan a número para mostrarlos. */
export function aNumero(valor: unknown): number {
  if (valor === null || valor === undefined) return 0;
  if (typeof valor === "number") return valor;
  return Number(valor.toString());
}

export function moneda(valor: unknown): string {
  return formateadorMoneda.format(aNumero(valor));
}

export function cantidad(valor: unknown): string {
  return formateadorCantidad.format(aNumero(valor));
}

/**
 * Decimal como texto plano para un campo de captura: al menos dos decimales y
 * los demás solo si no son cero («36» → «36.00», «0.3350» → «0.335»). Trabaja
 * sobre el texto, sin pasar por punto flotante.
 */
export function decimalEnTexto(valor: unknown, minimo = 2): string {
  if (valor === null || valor === undefined) return "";
  const texto = String(valor);
  if (!/^-?\d+(\.\d+)?$/.test(texto)) return texto;
  const [entero, fraccion = ""] = texto.split(".");
  return `${entero}.${fraccion.replace(/0+$/, "").padEnd(minimo, "0")}`;
}

/**
 * Texto para comparar en una búsqueda: sin acentos ni mayúsculas, como
 * texto_buscable() en la base («Peña Ñúñez» → «pena nunez»).
 */
export function textoBuscable(valor: string): string {
  return valor.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
