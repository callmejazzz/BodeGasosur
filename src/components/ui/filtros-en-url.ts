"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

/*
  Los filtros viven en la URL: el servidor consulta y la barra solo la
  reescribe. El texto se aplica con un pequeño retardo mientras se teclea; los
  demás controles, al instante.
*/

const RETARDO_MS = 50;

export function useFiltrosEnUrl<F extends object>(filtros: F, aParametros: (f: F) => URLSearchParams) {
  const router = useRouter();
  const pathname = usePathname();
  const [pendiente, iniciar] = useTransition();
  // `ultimo` es el último filtro que la persona pidió, aplicado o en espera;
  // toda navegación sale de ahí, así que un retardo pendiente nunca pisa un
  // cambio posterior. `actual` es lo mismo, para que los controles lo dibujen.
  const ultimo = useRef(filtros);
  const [actual, setActual] = useState(filtros);
  const navegado = useRef(aParametros(filtros).toString());
  const temporizador = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Si la URL cambia por fuera (atrás/adelante), la barra la adopta.
  const claveUrl = aParametros(filtros).toString();
  useEffect(() => {
    if (claveUrl === navegado.current) return;
    navegado.current = claveUrl;
    ultimo.current = filtros;
    setActual(filtros);
  }, [claveUrl, filtros]);

  useEffect(() => () => clearTimeout(temporizador.current), []);

  const navegar = () => {
    clearTimeout(temporizador.current);
    const p = aParametros(ultimo.current);
    navegado.current = p.toString();
    iniciar(() => router.replace(p.size ? `${pathname}?${p}` : pathname, { scroll: false }));
  };

  const recordar = (cambios: Partial<F>) => {
    ultimo.current = { ...ultimo.current, ...cambios };
    setActual(ultimo.current);
  };

  /** Cambio inmediato: cancela lo que estuviera en espera y navega con todo lo pedido. */
  const aplicar = (cambios: Partial<F>) => {
    recordar(cambios);
    navegar();
  };

  /** Texto: navega cuando se deja de teclear. */
  const teclear = (cambios: Partial<F>) => {
    recordar(cambios);
    clearTimeout(temporizador.current);
    temporizador.current = setTimeout(navegar, RETARDO_MS);
  };

  return { actual, pendiente, aplicar, teclear };
}
