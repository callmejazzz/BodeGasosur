"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, Suspense, use, useId, useState, type ReactNode } from "react";
import { CATALOGOS } from "@/lib/catalogos/definiciones";
import type { Contadores, RutaConContador } from "@/lib/navegacion/contadores";
import { cantidad, cn } from "@/lib/utils";

export type Accesos = { salidas: boolean; traspasos: boolean; devoluciones: boolean; prestamos: boolean; ajustes: boolean; reportes: boolean; usuarios: boolean };

type Enlace = { href: string; etiqueta: string; acceso?: keyof Accesos };

const ADMINISTRACION: Enlace[] = [{ href: "/usuarios", etiqueta: "Usuarios", acceso: "usuarios" }];

const OPERACION: Enlace[] = [
  { href: "/", etiqueta: "Tablero" },
  { href: "/entradas", etiqueta: "Entradas" },
  { href: "/salidas", etiqueta: "Salidas", acceso: "salidas" },
  { href: "/traspasos", etiqueta: "Traspasos", acceso: "traspasos" },
  { href: "/devoluciones", etiqueta: "Devoluciones", acceso: "devoluciones" },
  { href: "/prestamos", etiqueta: "Préstamos", acceso: "prestamos" },
  { href: "/conteos", etiqueta: "Conteo físico", acceso: "ajustes" },
  { href: "/ajustes", etiqueta: "Ajustes", acceso: "ajustes" },
];

const REPORTES: Enlace[] = [
  { href: "/reportes/semanal", etiqueta: "Semanal", acceso: "reportes" },
  { href: "/reportes/existencias", etiqueta: "Existencias", acceso: "reportes" },
  { href: "/reportes/kardex", etiqueta: "Kardex", acceso: "reportes" },
  { href: "/reportes/gasto", etiqueta: "Gasto por estación", acceso: "reportes" },
  { href: "/reportes/frecuencia", etiqueta: "Frecuencia de consumo", acceso: "reportes" },
];

const PENDIENTES: Record<RutaConContador, [string, string]> = {
  "/entradas": ["entrada en borrador", "entradas en borrador"],
  "/salidas": ["salida sin cerrar", "salidas sin cerrar"],
  "/traspasos": ["traspaso en borrador", "traspasos en borrador"],
  "/devoluciones": ["devolución en borrador", "devoluciones en borrador"],
  "/prestamos": ["préstamo abierto", "préstamos abiertos"],
  "/conteos": ["conteo en borrador", "conteos en borrador"],
  "/reportes/existencias": ["artículo bajo mínimo", "artículos bajo mínimo"],
};

const tieneContador = (href: string): href is RutaConContador => href in PENDIENTES;

const ENCABEZADO = "text-xs font-semibold tracking-wider text-white/85 uppercase";
const TEXTO_MODULO = "text-white/70";
const LINEA = "border-l border-dashed border-white/30";
const DESPLIEGUE = "duration-300 ease-in-out motion-reduce:transition-none";

function Contador({ contadores, ruta }: { contadores: Promise<Contadores>; ruta: RutaConContador }) {
  const n = use(contadores)[ruta] ?? 0;
  if (n === 0) return null;
  const pendientes = PENDIENTES[ruta][n === 1 ? 0 : 1];
  return (
    <span title={`${cantidad(n)} ${pendientes}`} className="min-w-5 rounded-full bg-warning-soft px-1.5 py-0.5 text-center text-xs font-semibold text-warning tabular-nums">
      {cantidad(n)}
      <span className="sr-only"> {pendientes}</span>
    </span>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="mb-6">
      <p className={cn("mb-1.5 px-3", ENCABEZADO)}>{titulo}</p>
      <nav className="flex flex-col gap-0.5">{children}</nav>
    </div>
  );
}

function SeccionDesplegable({ titulo, abierta, alternar, resumen, children }: {
  titulo: string;
  abierta: boolean;
  alternar: () => void;
  resumen?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={alternar}
        aria-expanded={abierta}
        aria-controls={id}
        className={cn("flex w-full items-center justify-between gap-2 rounded-md px-3 py-1 text-left transition-colors hover:bg-white/10", ENCABEZADO)}
      >
        {titulo}
        <span className="flex items-center gap-2 normal-case tracking-normal">
          {!abierta && resumen}
          <ChevronDown aria-hidden className={cn("size-4 transition-transform", DESPLIEGUE, !abierta && "-rotate-90")} />
        </span>
      </button>
      {/* Animar de 0fr a 1fr anima la altura sin medirla; inert saca del tabulador la lista cerrada */}
      <div
        id={id}
        inert={!abierta}
        className={cn("grid transition-[grid-template-rows,opacity]", DESPLIEGUE, abierta ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}
      >
        <div className="overflow-hidden">
          <nav className={cn("mt-1.5 mb-3 ml-3 flex flex-col gap-0.5 pl-2", LINEA)}>{children}</nav>
        </div>
      </div>
    </div>
  );
}

function Item({ enlace, activo, contador }: { enlace: Enlace; activo: boolean; contador?: ReactNode }) {
  return (
    <Link
      href={enlace.href}
      className={cn(
        "flex items-center justify-between gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
        activo ? "bg-white/15 font-medium text-white" : cn(TEXTO_MODULO, "hover:bg-white/10"),
      )}
    >
      {enlace.etiqueta}
      {contador}
    </Link>
  );
}

type Desplegable = "reportes" | "catalogos";

const desplegableDe = (ruta: string): Desplegable | null =>
  ruta.startsWith("/reportes") ? "reportes" : ruta.startsWith("/catalogos") ? "catalogos" : null;

export function Navegacion({ sesion, accesos, contadores }: { sesion?: ReactNode; accesos: Accesos; contadores: Promise<Contadores> | null }) {
  const ruta = usePathname();
  const visibles = (enlaces: Enlace[]) => enlaces.filter((e) => !e.acceso || accesos[e.acceso]);
  const administracion = visibles(ADMINISTRACION);
  const reportes = visibles(REPORTES);

  // Una desplegable a la vez
  const [abierta, setAbierta] = useState({ ruta, seccion: desplegableDe(ruta) });
  if (abierta.ruta !== ruta) setAbierta({ ruta, seccion: desplegableDe(ruta) ?? abierta.seccion });
  const alternar = (seccion: Desplegable) => () => setAbierta((a) => ({ ...a, seccion: a.seccion === seccion ? null : seccion }));

  const contador = (href: string) =>
    contadores && tieneContador(href) ? (
      <Suspense fallback={null}>
        <Contador contadores={contadores} ruta={href} />
      </Suspense>
    ) : undefined;

  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col self-start overflow-y-auto bg-primary px-3 py-5 text-white">
      <Link href="/" className="mb-7 block px-3">
        <span className="block text-lg leading-tight font-semibold">BodeGasosur</span>
        <span className="block text-xs text-white/50">Control de inventario</span>
      </Link>

      <Seccion titulo="Operación">
        {visibles(OPERACION).map((e) => (
          <Item key={e.href} enlace={e} activo={e.href === "/" ? ruta === "/" : ruta.startsWith(e.href)} contador={contador(e.href)} />
        ))}
      </Seccion>

      {reportes.length > 0 && (
        <SeccionDesplegable
          titulo="Reportes"
          abierta={abierta.seccion === "reportes"}
          alternar={alternar("reportes")}
          resumen={reportes.map((e) => <Fragment key={e.href}>{contador(e.href)}</Fragment>)}
        >
          {reportes.map((e) => (
            <Item key={e.href} enlace={e} activo={ruta.startsWith(e.href)} contador={contador(e.href)} />
          ))}
        </SeccionDesplegable>
      )}

      <SeccionDesplegable titulo="Catálogos" abierta={abierta.seccion === "catalogos"} alternar={alternar("catalogos")}>
        {CATALOGOS.map((c) => (
          <Item
            key={c.slug}
            enlace={{ href: `/catalogos/${c.slug}`, etiqueta: c.titulo }}
            activo={ruta.startsWith(`/catalogos/${c.slug}`)}
          />
        ))}
      </SeccionDesplegable>

      {administracion.length > 0 && (
        <Seccion titulo="Administración">
          {administracion.map((e) => (
            <Item key={e.href} enlace={e} activo={ruta.startsWith(e.href)} />
          ))}
        </Seccion>
      )}

      <div className="mt-auto">
        {sesion}
      </div>
    </aside>
  );
}
