"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { acotarPagina, rangoDe, type Pagina } from "@/lib/paginacion";
import { cn } from "@/lib/utils";

export type PaginaDeOpciones<O> = { opciones: O[]; pagina: Pagina; aviso: string | null };

const RETARDO_MS = 200;
const VACIA: Pagina = acotarPagina(1, 0);

/*
  Un selector que se abre como cualquier otro y que además se busca
  tecleando. Las opciones no se precargan: `cargar` trae del servidor una
  página de hasta 100 con lo tecleado, y el pie pasa a la siguiente.
*/
export function SelectorBuscable<O extends { id: string }>({
  valor,
  alElegir,
  cargar,
  etiqueta,
  detalle,
  vacio,
  placeholder,
  deshabilitado,
  etiquetadoPor,
}: {
  valor: O | null;
  alElegir: (opcion: O | null) => void;
  cargar: (texto: string, pagina: number) => Promise<PaginaDeOpciones<O>>;
  etiqueta: (opcion: O) => string;
  detalle?: (opcion: O) => ReactNode;
  /** La opción de no elegir ninguna, siempre primero. */
  vacio: string;
  placeholder: string;
  deshabilitado?: boolean;
  etiquetadoPor?: string;
}) {
  const lista = useId();
  const valorId = `${lista}-valor`;
  const raiz = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const temporizador = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Cada búsqueda lleva su número: una respuesta que llega tarde no pisa a la última.
  const ultima = useRef(0);
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");
  const [resultado, setResultado] = useState<PaginaDeOpciones<O>>({ opciones: [], pagina: VACIA, aviso: null });
  const [cargando, setCargando] = useState(false);
  const [activa, setActiva] = useState(0);
  const elementos: (O | null)[] = [null, ...resultado.opciones];

  useEffect(() => () => clearTimeout(temporizador.current), []);
  useEffect(() => {
    if (!abierto) return;
    const fuera = (ev: MouseEvent) => {
      if (!raiz.current?.contains(ev.target as Node)) setAbierto(false);
    };
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [abierto]);

  const pedir = (q: string, pagina: number, retardo = 0) => {
    clearTimeout(temporizador.current);
    const n = ++ultima.current;
    setCargando(true);
    temporizador.current = setTimeout(async () => {
      let r: PaginaDeOpciones<O>;
      try {
        r = await cargar(q, pagina);
      } catch {
        r = { opciones: [], pagina: VACIA, aviso: "No se pudo buscar. Inténtalo de nuevo." };
      }
      if (n !== ultima.current) return;
      setResultado(r);
      setActiva(r.opciones.length > 0 ? 1 : 0);
      setCargando(false);
    }, retardo);
  };

  const abrir = (inicial: string) => {
    if (deshabilitado) return;
    setTexto(inicial);
    setAbierto(true);
    pedir(inicial, 1);
  };
  const cerrar = (devolverFoco: boolean) => {
    setAbierto(false);
    if (devolverFoco) boton.current?.focus();
  };
  const elegir = (opcion: O | null) => {
    alElegir(opcion);
    cerrar(true);
  };

  const alTeclearEnBoton = (ev: KeyboardEvent<HTMLButtonElement>) => {
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      abrir("");
    } else if (ev.key.length === 1 && ev.key !== " " && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
      // Teclear sobre el selector cerrado ya es buscar.
      ev.preventDefault();
      abrir(ev.key);
    }
  };
  const alTeclearEnBusqueda = (ev: KeyboardEvent<HTMLInputElement>) => {
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      setActiva((a) => Math.min(a + 1, elementos.length - 1));
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      setActiva((a) => Math.max(a - 1, 0));
    } else if (ev.key === "Enter") {
      // Elige; no envía el formulario.
      ev.preventDefault();
      if (!cargando && activa < elementos.length && (activa > 0 || !texto.trim())) {
        elegir(elementos[activa])
      }
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      cerrar(true);
    } else if (ev.key === "Tab") {
      cerrar(false);
    }
  };

  const { pagina } = resultado;
  const { desde, hasta } = rangoDe(pagina);
  const opcionId = (i: number) => `${lista}-${i}`;

  return (
    <div ref={raiz} className="relative">
      <button
        ref={boton}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={abierto}
        aria-labelledby={etiquetadoPor ? `${etiquetadoPor} ${valorId}` : valorId}
        disabled={deshabilitado}
        onClick={() => (abierto ? cerrar(false) : abrir(""))}
        onKeyDown={alTeclearEnBoton}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-border-strong bg-surface px-3 text-left text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary disabled:opacity-50"
      >
        <span id={valorId} className={cn("truncate", !valor && "text-muted")}>{valor ? etiqueta(valor) : vacio}</span>
        <span aria-hidden className="text-xs text-muted">▾</span>
      </button>

      {abierto && (
        <div className="absolute z-20 mt-1 w-full min-w-72 rounded-md border border-border bg-surface shadow-lg">
          <div className="border-b border-border p-2">
            <input
              autoFocus
              role="combobox"
              aria-expanded
              aria-controls={lista}
              aria-autocomplete="list"
              aria-activedescendant={opcionId(activa)}
              aria-labelledby={etiquetadoPor}
              value={texto}
              onChange={(ev) => {
                setTexto(ev.target.value);
                pedir(ev.target.value, 1, RETARDO_MS);
              }}
              onKeyDown={alTeclearEnBusqueda}
              maxLength={40}
              placeholder={placeholder}
              className="h-8 w-full rounded-md border border-border-strong bg-surface px-2 text-sm placeholder:text-muted focus-visible:outline-2 focus-visible:outline-primary"
            />
          </div>
          <ul id={lista} role="listbox" aria-busy={cargando} className="max-h-72 overflow-y-auto py-1 text-sm">
            {elementos.map((o, i) => (
              <li
                key={o?.id ?? ""}
                id={opcionId(i)}
                role="option"
                aria-selected={(o?.id ?? null) === (valor?.id ?? null)}
                onMouseDown={(ev) => ev.preventDefault()}
                onMouseEnter={() => setActiva(i)}
                onClick={() => elegir(o)}
                className={cn("cursor-pointer px-3 py-1.5", i === activa && "bg-surface-muted", (o?.id ?? null) === (valor?.id ?? null) && "font-medium")}
              >
                {o ? (
                  <>
                    <span>{etiqueta(o)}</span>
                    {detalle && <span className="block text-xs text-muted">{detalle(o)}</span>}
                  </>
                ) : (
                  <span className="text-muted">{vacio}</span>
                )}
              </li>
            ))}
          </ul>
          <div className="border-t border-border px-3 py-2 text-xs text-muted" aria-live="polite">
            {cargando ? (
              "Buscando…"
            ) : resultado.aviso ? (
              <span className="text-warning">{resultado.aviso}</span>
            ) : pagina.total === 0 ? (
              texto.trim() ? "Nada coincide con la búsqueda." : "No hay opciones."
            ) : (
              <span className="flex items-center justify-between gap-2">
                <span className="tabular">{pagina.ultima > 1 ? `${desde}–${hasta} de ${pagina.total}` : `${pagina.total} en total`}</span>
                {pagina.ultima > 1 && (
                  <span className="flex items-center gap-1">
                    {[
                      [pagina.actual - 1, "‹ Anterior", pagina.actual > 1],
                      [pagina.actual + 1, "Siguiente ›", pagina.actual < pagina.ultima],
                    ].map(([n, rotulo, activo]) => (
                      <button
                        key={String(rotulo)}
                        type="button"
                        disabled={!activo}
                        onMouseDown={(ev) => ev.preventDefault()}
                        onClick={() => pedir(texto, Number(n))}
                        className="rounded px-1.5 py-0.5 text-primary hover:bg-surface-muted disabled:text-muted/60 disabled:hover:bg-transparent"
                      >
                        {rotulo}
                      </button>
                    ))}
                  </span>
                )}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
