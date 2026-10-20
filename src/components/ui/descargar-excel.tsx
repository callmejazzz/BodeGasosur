"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";

const TIPO_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/*
  Descarga en Excel la tabla con los filtros que se ven. El servidor arma el
  libro completo; si no puede, el mensaje se muestra aquí y no se guarda nada.
  El ref corta el segundo clic antes de que el render deshabilite el botón.
*/
export function DescargarExcel({ href, etiqueta = "Descargar Excel" }: { href: string; etiqueta?: string }) {
  const [generando, setGenerando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const enCurso = useRef(false);

  const descargar = async () => {
    if (enCurso.current) return;
    enCurso.current = true;
    setGenerando(true);
    setMensaje(null);
    try {
      const r = await fetch(href, { cache: "no-store" });
      if (!r.ok || r.headers.get("Content-Type") !== TIPO_XLSX) {
        const cuerpo: unknown = await r.json().catch(() => null);
        const texto = cuerpo && typeof cuerpo === "object" && "mensaje" in cuerpo && typeof cuerpo.mensaje === "string" ? cuerpo.mensaje : null;
        setMensaje(texto ?? "No se pudo generar el archivo.");
        return;
      }
      const archivo = await r.blob();
      const nombre = /filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") ?? "")?.[1] ?? "tabla.xlsx";
      const url = URL.createObjectURL(archivo);
      const enlace = document.createElement("a");
      enlace.href = url;
      enlace.download = nombre;
      document.body.append(enlace);
      enlace.click();
      enlace.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setMensaje("No se pudo descargar. Revisa la conexión e inténtalo de nuevo.");
    } finally {
      enCurso.current = false;
      setGenerando(false);
    }
  };

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button type="button" variante="secundario" onClick={descargar} disabled={generando} aria-busy={generando}>
        {generando ? "Generando…" : etiqueta}
      </Button>
      {mensaje && (
        <span role="alert" className="max-w-80 text-right text-xs text-danger">
          {mensaje}
        </span>
      )}
    </span>
  );
}
