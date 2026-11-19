"use client";

import { ChevronDown, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, Suspense, use, useEffect, useId, useRef, useState, type ReactNode } from "react";
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

// Debajo de lg la barra lateral es un menú que se abre desde la barra superior
const ESCRITORIO = "(min-width: 1024px)";

export function Navegacion({ sesion, accesos, contadores, children }: {
  sesion?: ReactNode;
  accesos: Accesos;
  contadores: Promise<Contadores> | null;
  children: ReactNode;
}) {
  const ruta = usePathname();
  const visibles = (enlaces: Enlace[]) => enlaces.filter((e) => !e.acceso || accesos[e.acceso]);
  const administracion = visibles(ADMINISTRACION);
  const reportes = visibles(REPORTES);

  // Una desplegable a la vez. Al cambiar de ruta se cierra el menú
  const [estado, setEstado] = useState({ ruta, seccion: desplegableDe(ruta), menu: false });
  if (estado.ruta !== ruta) setEstado({ ruta, seccion: desplegableDe(ruta) ?? estado.seccion, menu: false });
  const alternar = (seccion: Desplegable) => () => setEstado((e) => ({ ...e, seccion: e.seccion === seccion ? null : seccion }));

  const botonMenu = useRef<HTMLButtonElement>(null);
  const botonCerrar = useRef<HTMLButtonElement>(null);
  // Cerrado a mano, el foco vuelve al botón del menú; al navegar, no
  const devolverFoco = useRef(false);
  const abrirMenu = () => setEstado((e) => ({ ...e, menu: true }));
  const cerrarMenu = () => {
    devolverFoco.current = true;
    setEstado((e) => ({ ...e, menu: false }));
  };

  useEffect(() => {
    if (!estado.menu) {
      if (devolverFoco.current) botonMenu.current?.focus();
      devolverFoco.current = false;
      return;
    }
    botonCerrar.current?.focus();
    const raiz = document.documentElement;
    raiz.style.overflow = "hidden";
    const alTeclear = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      devolverFoco.current = true;
      setEstado((e) => ({ ...e, menu: false }));
    };
    const escritorio = window.matchMedia(ESCRITORIO);
    const alCrecer = () => escritorio.matches && setEstado((e) => ({ ...e, menu: false }));
    document.addEventListener("keydown", alTeclear);
    escritorio.addEventListener("change", alCrecer);
    return () => {
      raiz.style.overflow = "";
      document.removeEventListener("keydown", alTeclear);
      escritorio.removeEventListener("change", alCrecer);
    };
  }, [estado.menu]);

  const contador = (href: string) =>
    contadores && tieneContador(href) ? (
      <Suspense fallback={null}>
        <Contador contadores={contadores} ruta={href} />
      </Suspense>
    ) : undefined;

  return (
    <div className="flex min-h-full w-full flex-col lg:flex-row">
      <header inert={estado.menu} className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 bg-primary px-4 text-white lg:hidden">
        <Link href="/" className="text-lg font-semibold">BodeGasosur</Link>
        <button
          ref={botonMenu}
          type="button"
          onClick={abrirMenu}
          aria-expanded={estado.menu}
          aria-controls="navegacion"
          className="-mr-2 rounded-md p-2 transition-colors hover:bg-white/10"
        >
          <Menu aria-hidden className="size-5" />
          <span className="sr-only">Abrir menú</span>
        </button>
      </header>

      <div
        aria-hidden
        onClick={cerrarMenu}
        className={cn("fixed inset-0 z-40 bg-black/40 transition-opacity duration-300 lg:hidden", estado.menu ? "opacity-100" : "pointer-events-none opacity-0")}
      />

      <aside
        id="navegacion"
        aria-label="Navegación"
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col overflow-y-auto bg-primary px-3 py-5 text-white motion-reduce:transition-none",
          "lg:visible lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:w-60 lg:max-w-none lg:shrink-0 lg:translate-x-0 lg:self-start lg:transition-none",
          // Se hace visible al instante para poder enfocarlo, y se oculta hasta terminar de cerrarse
          estado.menu
            ? "visible translate-x-0 [transition:translate_300ms_ease-in-out,visibility_0s]"
            : "invisible -translate-x-full [transition:translate_300ms_ease-in-out,visibility_0s_300ms]",
        )}
      >
        <div className="mb-7 flex items-start justify-between gap-2 px-3">
          <Link href="/" className="block">
            <span className="block text-lg leading-tight font-semibold">BodeGasosur</span>
            <span className="block text-xs text-white/50">Control de inventario</span>
          </Link>
          <button ref={botonCerrar} type="button" onClick={cerrarMenu} className="-mt-1 -mr-2 rounded-md p-2 transition-colors hover:bg-white/10 lg:hidden">
            <X aria-hidden className="size-5" />
            <span className="sr-only">Cerrar menú</span>
          </button>
        </div>

        <Seccion titulo="Operación">
          {visibles(OPERACION).map((e) => (
            <Item key={e.href} enlace={e} activo={e.href === "/" ? ruta === "/" : ruta.startsWith(e.href)} contador={contador(e.href)} />
          ))}
        </Seccion>

        {reportes.length > 0 && (
          <SeccionDesplegable
            titulo="Reportes"
            abierta={estado.seccion === "reportes"}
            alternar={alternar("reportes")}
            resumen={reportes.map((e) => <Fragment key={e.href}>{contador(e.href)}</Fragment>)}
          >
            {reportes.map((e) => (
              <Item key={e.href} enlace={e} activo={ruta.startsWith(e.href)} contador={contador(e.href)} />
            ))}
          </SeccionDesplegable>
        )}

        <SeccionDesplegable titulo="Catálogos" abierta={estado.seccion === "catalogos"} alternar={alternar("catalogos")}>
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

      <main inert={estado.menu} className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">{children}</main>
    </div>
  );
}
