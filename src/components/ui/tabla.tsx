import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** El contenedor scrollea horizontalmente para que la página nunca lo haga. */
export function Tabla({ className, ...props }: ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full border-collapse text-sm", className)} {...props} />
    </div>
  );
}

export function Th({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      className={cn(
        "border-b border-border bg-surface-muted px-4 py-2.5 text-left text-xs font-semibold tracking-wide whitespace-nowrap text-muted-strong uppercase",
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: ComponentProps<"td">) {
  return (
    <td
      className={cn("border-b border-border px-4 py-2.5 align-middle", className)}
      {...props}
    />
  );
}

export function Tr({ className, ...props }: ComponentProps<"tr">) {
  return <tr className={cn("hover:bg-surface-muted/60", className)} {...props} />;
}
