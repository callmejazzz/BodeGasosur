import Link from "next/link";
import { notFound } from "next/navigation";
import { guardarCatalogo } from "../actions";
import { DetalleCatalogo } from "@/components/catalogos/detalle-catalogo";
import { FormularioCatalogo } from "@/components/catalogos/formulario-catalogo";
import type { ValoresFormulario } from "@/lib/catalogos/formulario";
import { Card, CardHeader, EncabezadoPagina } from "@/components/ui/superficies";
import {
  catalogoPorSlug,
  necesitaOpciones,
  type CatalogoDef,
  type FuenteOpciones,
} from "@/lib/catalogos/definiciones";
import { cargarOpciones, leerRuta, REPOS } from "@/lib/catalogos/repos";
import { consultar } from "@/lib/db";
import { rolTienePermiso } from "@/lib/permisos";
import { aNumero } from "@/lib/utils";

/**
 * Lo que este registro ya tiene asignado en cada `select`.
 *
 * `cargarOpciones()` filtra por activo, así que sin esto un vínculo a algo dado
 * de baja desaparecía de la lista y guardar lo rompía. Con esto la opción sigue
 * ahí, marcada, y solo en el registro que ya la tenía.
 */
function relacionesActuales(def: CatalogoDef, registro: { id: string }) {
  const conservar: Partial<Record<FuenteOpciones, string>> = {};
  for (const campo of def.campos) {
    if (campo.tipo !== "select" || !campo.fuente) continue;
    const id = leerRuta(registro, campo.nombre);
    if (typeof id === "string" && id.length > 0) conservar[campo.fuente] = id;
  }
  return conservar;
}

/**
 * Los valores que el formulario necesita. Vive fuera del componente y se llama
 * dentro de la rama que lo dibuja: quien solo consulta no arma este objeto.
 */
function valoresDe(def: CatalogoDef, registro: { id: string }): ValoresFormulario {
  const valores: ValoresFormulario = {};
  for (const campo of def.campos) {
    const valor = leerRuta(registro, campo.nombre);
    if (campo.tipo === "booleano") {
      valores[campo.nombre] = valor === true;
    } else if (campo.tipo === "numero") {
      // Nulo no es cero, y aquí la diferencia rompía el guardado: «sin piezas
      // por caja» se dibujaba como 0, y 0 viola `articulo_piezas_por_caja_ck`
      // —que exige nulo o mayor que cero—. El campo se queda vacío, que es lo
      // que su propia ayuda pide y lo que la tabla ya hacía.
      valores[campo.nombre] =
        valor === null || valor === undefined ? "" : String(aNumero(valor));
    } else {
      valores[campo.nombre] = valor === null || valor === undefined ? "" : String(valor);
    }
  }
  return valores;
}

export default async function PaginaEditar({ params }: PageProps<"/catalogos/[slug]/[id]">) {
  const { slug, id } = await params;
  const def = catalogoPorSlug(slug);
  const repo = REPOS[slug];
  if (!def || !repo) notFound();

  // Leer siempre exige solo `catalogos:leer`; el permiso de escritura se deriva
  // del mismo `usuario` que `consultar` ya entrega, en la misma operación.
  //
  // El permiso se calcula ANTES de leer, para no pagar las tres consultas de
  // `cargarOpciones()` por quien va a ver el detalle: ahí no hay `select` que
  // llenar. Y tampoco se pagan en los seis catálogos que no tienen ninguno,
  // aunque quien mire sí pueda editar.
  const { registro, opciones, puedeEscribir } = await consultar(
    "catalogos:leer",
    async (db, usuario) => {
      const puedeEscribir = rolTienePermiso(usuario.rol, def.permisoEscritura);
      const registro = await repo.obtener(db, id);

      // Las opciones van después del registro porque necesitan saber qué tiene
      // ya asignado. No cuesta latencia: dentro de una transacción interactiva
      // las consultas se serializan sobre una sola conexión de todos modos.
      const opciones =
        registro && puedeEscribir && necesitaOpciones(def)
          ? await cargarOpciones(db, relacionesActuales(def, registro))
          : undefined;

      return { registro, opciones, puedeEscribir };
    },
  );
  if (!registro) notFound();

  const titulo = String(leerRuta(registro, def.campoTitulo) ?? def.singular);

  return (
    <>
      <EncabezadoPagina
        titulo={titulo}
        descripcion={puedeEscribir ? `Editando ${def.singular}` : `Detalle ${def.genero === "f" ? "de la" : "del"} ${def.singular}`}
      />
      <Card className="max-w-3xl">
        <CardHeader
          titulo={`Datos ${def.genero === "f" ? "de la" : "del"} ${def.singular}`}
          descripcion={
            puedeEscribir
              ? "Los cambios afectan las capturas futuras; los movimientos ya registrados conservan lo que se guardó en su momento."
              : "Tu rol permite consultar este catálogo, no modificarlo."
          }
        />
        {puedeEscribir ? (
          <FormularioCatalogo
            def={def}
            modo="edicion"
            opciones={opciones ?? {}}
            valores={valoresDe(def, registro)}
            accion={guardarCatalogo.bind(null, slug, id)}
            textoGuardar="Guardar cambios"
          />
        ) : (
          <DetalleCatalogo def={def} registro={registro} />
        )}
      </Card>

      {!puedeEscribir && (
        <p className="mt-4 max-w-3xl">
          <Link href={`/catalogos/${slug}`} className="text-sm text-primary hover:underline">
            ← Volver a {def.titulo.toLowerCase()}
          </Link>
        </p>
      )}
    </>
  );
}
