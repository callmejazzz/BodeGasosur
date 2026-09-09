"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Vuelve a pedir el árbol del servidor al recuperar el foco.
 *
 * Next.js no vuelve a ejecutar los layouts al navegar entre rutas hermanas, así
 * que a quien le cambian el rol conserva la barra lateral anterior hasta que
 * recargue. Con esto, al volver a la pestaña se llama a `router.refresh()`,
 * `(sistema)/layout.tsx` ejecuta otra vez `sesionActual()` —que lee de
 * PostgreSQL, no del token— y React reconcilia la barra.
 *
 * Escucha los dos eventos porque cubren casos distintos: `visibilitychange`
 * atrapa el cambio de pestaña, y `focus` el regreso desde otra aplicación con
 * la pestaña ya visible. Al volver a una pestaña ocurren los dos, de ahí la
 * guarda de tiempo: si no, cada regreso pediría el árbol dos veces.
 *
 * La marca inicial se pone al montar —dentro del efecto, no en el render, que
 * debe ser puro— para no refrescar por el primer clic dentro de una página
 * recién dibujada.
 */
export function RefrescarAlEnfocar() {
  const router = useRouter();
  const ultimoRefresco = useRef(0);

  useEffect(() => {
    ultimoRefresco.current = Date.now();

    const refrescar = () => {
      if (document.visibilityState !== "visible") return;

      const ahora = Date.now();
      if (ahora - ultimoRefresco.current < 1000) return;
      ultimoRefresco.current = ahora;

      router.refresh();
    };

    document.addEventListener("visibilitychange", refrescar);
    window.addEventListener("focus", refrescar);
    return () => {
      document.removeEventListener("visibilitychange", refrescar);
      window.removeEventListener("focus", refrescar);
    };
  }, [router]);

  return null;
}
