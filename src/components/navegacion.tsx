"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CATALOGOS } from "@/lib/catalogos/definiciones";
import { cn } from "@/lib/utils";
import packageJson from "../../package.json";

const { version } = packageJson;

/** Lo que el layout decidió en el servidor: la matriz no viaja al cliente. */
export type Accesos = { salidas: boolean; traspasos: boolean; devoluciones: boolean; prestamos: boolean; ajustes: boolean; usuarios: boolean };

type Enlace = { href: string; etiqueta: string; proximamente?: boolean; acceso?: keyof Accesos };

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
  { href: "/movimientos", etiqueta: "Movimientos", proximamente: true },
  { href: "/existencias", etiqueta: "Existencias", proximamente: true },
  { href: "/kardex", etiqueta: "Kardex", proximamente: true },
];

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <p className="mb-1.5 px-3 text-xs font-semibold tracking-wider text-white/40 uppercase">
        {titulo}
      </p>
      <nav className="flex flex-col gap-0.5">{children}</nav>
    </div>
  );
}

function Item({ enlace, activo }: { enlace: Enlace; activo: boolean }) {
  if (enlace.proximamente) {
    return (
      <span
        className="flex cursor-not-allowed items-center justify-between rounded-md px-3 py-1.5 text-sm text-white/35"
        title="Se construye en las siguientes fases"
      >
        {enlace.etiqueta}
        <span className="text-[10px] tracking-wide text-white/25 uppercase">pendiente</span>
      </span>
    );
  }

  return (
    <Link
      href={enlace.href}
      className={cn(
        "rounded-md px-3 py-1.5 text-sm transition-colors",
        activo ? "bg-white/15 font-medium text-white" : "text-white/70 hover:bg-white/10",
      )}
    >
      {enlace.etiqueta}
    </Link>
  );
}

/**
 * `sesion` llega desde el layout: son componentes de servidor incrustados en
 * la barra. `accesos` también viene decidido de allá — este componente dibuja,
 * no decide: ocultar un enlace es presentación, y la puerta real sigue siendo
 * `consultar()` en cada pantalla.
 */
export function Navegacion({ sesion, accesos }: { sesion?: React.ReactNode; accesos: Accesos }) {
  const ruta = usePathname();
  const visibles = (enlaces: Enlace[]) => enlaces.filter((e) => !e.acceso || accesos[e.acceso]);
  const administracion = visibles(ADMINISTRACION);

  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col self-start overflow-y-auto bg-primary px-3 py-5 text-white">
      <Link href="/" className="mb-7 block px-3">
        <span className="block text-lg leading-tight font-semibold">BodeGasosur</span>
        <span className="block text-xs text-white/50">Control de inventario</span>
      </Link>

      <Seccion titulo="Operación">
        {visibles(OPERACION).map((e) => (
          <Item key={e.href} enlace={e} activo={e.href === "/" ? ruta === "/" : ruta.startsWith(e.href)} />
        ))}
      </Seccion>

      <Seccion titulo="Catálogos">
        {CATALOGOS.map((c) => (
          <Item
            key={c.slug}
            enlace={{ href: `/catalogos/${c.slug}`, etiqueta: c.titulo }}
            activo={ruta.startsWith(`/catalogos/${c.slug}`)}
          />
        ))}
      </Seccion>

      {administracion.length > 0 && (
        <Seccion titulo="Administración">
          {administracion.map((e) => (
            <Item key={e.href} enlace={e} activo={ruta.startsWith(e.href)} />
          ))}
        </Seccion>
      )}

      <div className="mt-auto">
        <p className="px-3 text-xs leading-relaxed text-white/35">
          BodeGasosur v{version} · fases 0 a 7 construidas. Siguen los reportes en la fase 8.
        </p>
        {sesion}
      </div>
    </aside>
  );
}
