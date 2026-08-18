import { cva, type VariantProps } from "class-variance-authority";
import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const estilos = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-50 whitespace-nowrap",
  {
    variants: {
      variante: {
        primario: "bg-primary text-white hover:bg-primary-hover",
        secundario:
          "bg-surface text-foreground border border-border-strong hover:bg-surface-muted",
        sutil: "text-muted-strong hover:bg-surface-muted hover:text-foreground",
        peligro: "bg-danger text-white hover:brightness-110",
      },
      tamano: {
        sm: "h-8 px-3",
        md: "h-9 px-4",
        lg: "h-10 px-5",
      },
    },
    defaultVariants: { variante: "primario", tamano: "md" },
  },
);

type Variantes = VariantProps<typeof estilos>;

export function Button({
  className,
  variante,
  tamano,
  ...props
}: ComponentProps<"button"> & Variantes) {
  return <button className={cn(estilos({ variante, tamano }), className)} {...props} />;
}

export function ButtonLink({
  className,
  variante,
  tamano,
  ...props
}: ComponentProps<typeof Link> & Variantes) {
  return <Link className={cn(estilos({ variante, tamano }), className)} {...props} />;
}
