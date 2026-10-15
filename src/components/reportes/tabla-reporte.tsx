import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/superficies";
import { Tabla, Td, Th, Tr } from "@/components/ui/tabla";
import type { Columna, Formato, Valor } from "@/lib/exportar/hoja";
import { formatearFecha, formatearInstante } from "@/lib/fechas";
import { cantidad, cn, moneda } from "@/lib/utils";

const formateadorCosto = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2, maximumFractionDigits: 4 });
const NUMERICO: Formato[] = ["entero", "importe", "costo"];

function texto(formato: Formato, valor: Valor): string | null {
  if (valor === null || valor === undefined || valor === "") return null;
  switch (formato) {
    case "entero":
      return cantidad(valor);
    case "importe":
      return moneda(valor);
    case "costo":
      return formateadorCosto.format(Number(String(valor)));
    case "fecha":
      return formatearFecha(valor as Date | string);
    case "instante":
      return formatearInstante(valor as Date);
    default:
      return String(valor);
  }
}

/** Las mismas columnas que el Excel, con formato de pantalla. */
export function TablaReporte<F extends { id: string }>({ columnas, filas }: { columnas: Columna<F>[]; filas: F[] }) {
  return (
    <Tabla>
      <thead>
        <tr>
          {columnas.map((c) => (
            <Th key={c.titulo} className={cn(NUMERICO.includes(c.formato) && "text-right")}>
              {c.titulo}
            </Th>
          ))}
        </tr>
      </thead>
      <tbody>
        {filas.map((f) => (
          <Tr key={f.id}>
            {columnas.map((c) => {
              const t = texto(c.formato, c.valor(f));
              const href = t && c.enlace?.(f);
              let contenido: ReactNode = t ?? <span className="text-muted">—</span>;
              if (t && c.insignia) contenido = <Badge tono={c.insignia}>{t}</Badge>;
              else if (href) contenido = <Link href={href} className="font-medium text-primary hover:underline">{t}</Link>;
              return (
                <Td
                  key={c.titulo}
                  className={cn(
                    NUMERICO.includes(c.formato) && "text-right tabular",
                    (NUMERICO.includes(c.formato) || c.formato === "fecha" || c.insignia || c.ancho === "sinSalto") && "whitespace-nowrap",
                    c.ancho === "amplio" && "min-w-56",
                  )}
                >
                  {contenido}
                </Td>
              );
            })}
          </Tr>
        ))}
      </tbody>
    </Tabla>
  );
}

/** El corte y los filtros con que se generó, como en el encabezado del Excel. */
export function ContextoReporte({ filtros, generado, aviso }: { filtros: [string, string][]; generado: Date; aviso?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-b border-border bg-surface-muted/40 px-5 py-2.5 text-xs text-muted-strong">
      {filtros.map(([etiqueta, valor]) => (
        <span key={etiqueta}>
          <span className="text-muted">{etiqueta}:</span> {valor}
        </span>
      ))}
      <span>
        <span className="text-muted">Generado:</span> {formatearInstante(generado)}
      </span>
      {aviso}
    </div>
  );
}

/** El valor conocido total; si hay piezas sin costo, lo dice y no lo llama total. */
export function ValorConocido({ importe, importeConIva, sinCosto, etiqueta = "Valor" }: { importe: string | null; importeConIva: string | null; sinCosto: string | null; etiqueta?: string }) {
  return (
    <dl className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-t border-border px-5 py-4 text-sm">
      <dt className="text-muted">{sinCosto ? `${etiqueta} conocido` : `${etiqueta} total`}</dt>
      <dd className="tabular">
        <span className="font-semibold">{importe === null ? "—" : moneda(importe)}</span>
        <span className="text-muted"> · {importeConIva === null ? "—" : moneda(importeConIva)} con IVA</span>
        {sinCosto && <span className="block text-right text-warning">{sinCosto}</span>}
      </dd>
    </dl>
  );
}
