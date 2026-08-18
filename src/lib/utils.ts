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
