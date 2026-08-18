import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

const baseControl =
  "w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary disabled:opacity-50";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(baseControl, "h-9", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(baseControl, "min-h-20 resize-y", className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(baseControl, "h-9 pr-8", className)} {...props} />;
}

export function Campo({
  etiqueta,
  ayuda,
  requerido,
  error,
  children,
}: {
  etiqueta: string;
  ayuda?: string;
  requerido?: boolean;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-muted-strong">
        {etiqueta}
        {requerido && <span className="ml-0.5 text-danger">*</span>}
      </span>
      {children}
      {ayuda && !error && <span className="text-xs text-muted">{ayuda}</span>}
      {error && <span className="text-xs font-medium text-danger">{error}</span>}
    </label>
  );
}

export function Checkbox({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      type="checkbox"
      className={cn(
        "size-4 rounded border-border-strong accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        className,
      )}
      {...props}
    />
  );
}
