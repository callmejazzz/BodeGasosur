import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("rounded-lg border border-border bg-surface shadow-sm", className)}
      {...props}
    />
  );
}

export function CardHeader({
  titulo,
  descripcion,
  acciones,
}: {
  titulo: ReactNode;
  descripcion?: ReactNode;
  acciones?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-foreground">{titulo}</h2>
        {descripcion && <p className="mt-0.5 text-sm text-muted">{descripcion}</p>}
      </div>
      {acciones && <div className="flex shrink-0 items-center gap-2">{acciones}</div>}
    </div>
  );
}

export function EncabezadoPagina({
  titulo,
  descripcion,
  acciones,
}: {
  titulo: string;
  descripcion?: string;
  acciones?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{titulo}</h1>
        {descripcion && <p className="mt-1 max-w-2xl text-sm text-muted">{descripcion}</p>}
      </div>
      {acciones && <div className="flex shrink-0 items-center gap-2">{acciones}</div>}
    </header>
  );
}

export function Badge({
  tono = "neutro",
  children,
}: {
  tono?: "neutro" | "exito" | "aviso" | "peligro" | "info";
  children: ReactNode;
}) {
  const tonos = {
    neutro: "bg-surface-muted text-muted-strong",
    exito: "bg-success-soft text-success",
    aviso: "bg-warning-soft text-warning",
    peligro: "bg-danger-soft text-danger",
    info: "bg-primary-soft text-primary",
  } as const;

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        tonos[tono],
      )}
    >
      {children}
    </span>
  );
}

export function EstadoVacio({
  titulo,
  descripcion,
  accion,
}: {
  titulo: string;
  descripcion?: string;
  accion?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <p className="text-sm font-medium text-foreground">{titulo}</p>
      {descripcion && <p className="max-w-sm text-sm text-muted">{descripcion}</p>}
      {accion}
    </div>
  );
}
