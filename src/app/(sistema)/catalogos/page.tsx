import Link from "next/link";
import { EncabezadoPagina } from "@/components/ui/superficies";
import { CATALOGOS } from "@/lib/catalogos/definiciones";
import { contarCatalogos } from "@/lib/catalogos/repos";
import { consultar } from "@/lib/db";
import { cantidad } from "@/lib/utils";

// Lee existencias y catálogos en cada visita: son datos vivos, no contenido estático.
export const dynamic = "force-dynamic";

export default async function PaginaCatalogos() {
  const conteos = await consultar("catalogos:leer", (db) => contarCatalogos(db));

  return (
    <>
      <EncabezadoPagina
        titulo="Catálogos"
        descripcion="Los datos base del sistema. Todo lo que se captura en un movimiento sale de aquí: por eso nada se escribe como texto libre salvo las observaciones."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {CATALOGOS.map((def) => (
          <Link
            key={def.slug}
            href={`/catalogos/${def.slug}`}
            className="flex flex-col rounded-lg border border-border bg-surface p-5 shadow-sm transition-colors hover:border-border-strong hover:bg-surface-muted"
          >
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-semibold text-foreground">{def.titulo}</h2>
              <span className="text-sm text-muted tabular">
                {cantidad(conteos[def.slug as keyof typeof conteos] ?? 0)}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted">{def.descripcion}</p>
          </Link>
        ))}
      </div>
    </>
  );
}
