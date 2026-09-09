import { Badge } from "@/components/ui/superficies";
import type { CampoDef, CatalogoDef } from "@/lib/catalogos/definiciones";
import { leerRuta } from "@/lib/catalogos/repos";
import { cantidad } from "@/lib/utils";

/**
 * El registro, en solo lectura, para quien puede consultar el catálogo pero no
 * escribirlo.
 *
 * No es el formulario deshabilitado, y la diferencia importa: el formulario
 * dibuja los `select` a partir de `cargarOpciones()`, que filtra por activo, y
 * una relación dada de baja se quedaría fuera de la lista y aparecería como
 * «sin especificar». Aquí la relación se lee del propio registro, así que se
 * ve aunque esté inactiva —y se marca como tal—.
 *
 * Muestra todos los campos, incluidos los que la tabla oculta: si no, quien no
 * puede editar perdería el móvil y el correo de las estaciones, que hoy solo
 * se ven abriendo el registro.
 */
export function DetalleCatalogo({
  def,
  registro,
}: {
  def: CatalogoDef;
  registro: { id: string };
}) {
  return (
    <dl className="grid gap-x-8 gap-y-5 px-5 py-5 sm:grid-cols-2">
      {def.campos.map((campo) => (
        <div key={campo.nombre} className="min-w-0">
          <dt className="mb-1 text-xs font-medium tracking-wide text-muted uppercase">
            {campo.etiqueta}
          </dt>
          <dd className="text-sm text-foreground">{valor(registro, campo, def)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Si la relación viene dada de baja, decirlo: explica por qué no se puede reasignar. */
function marcaDeBaja(registro: { id: string }, campo: CampoDef) {
  if (!campo.rutaTabla) return null;
  const relacion = leerRuta(registro, campo.rutaTabla.split(".")[0]);
  if (!relacion || typeof relacion !== "object") return null;

  const estado = (relacion as Record<string, unknown>).activa ?? (relacion as Record<string, unknown>).activo;
  if (estado !== false) return null;

  return (
    <span className="ml-2">
      <Badge tono="aviso">Dada de baja</Badge>
    </span>
  );
}

function valor(registro: { id: string }, campo: CampoDef, def: CatalogoDef) {
  const bruto = leerRuta(registro, campo.rutaTabla ?? campo.nombre);

  if (campo.esEstado) {
    const terminacion = def.genero === "f" ? "a" : "o";
    return bruto === true ? (
      <Badge tono="exito">{`Activ${terminacion}`}</Badge>
    ) : (
      <Badge tono="neutro">{`Inactiv${terminacion}`}</Badge>
    );
  }

  if (campo.tipo === "booleano") {
    return bruto === true ? <Badge tono="info">Sí</Badge> : <span className="text-muted">No</span>;
  }

  if (bruto === null || bruto === undefined || bruto === "") {
    return <span className="text-muted">—</span>;
  }

  if (campo.tipo === "numero") {
    return <span className="tabular">{cantidad(bruto)}</span>;
  }

  return (
    <span className="break-words">
      {String(bruto)}
      {campo.tipo === "select" && marcaDeBaja(registro, campo)}
    </span>
  );
}
