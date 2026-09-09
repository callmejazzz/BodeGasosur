import { notFound } from "next/navigation";
import { guardarCatalogo } from "../actions";
import { FormularioCatalogo } from "@/components/catalogos/formulario-catalogo";
import type { ValoresFormulario } from "@/lib/catalogos/formulario";
import { Card, CardHeader, EncabezadoPagina, EstadoVacio } from "@/components/ui/superficies";
import { catalogoPorSlug, necesitaOpciones } from "@/lib/catalogos/definiciones";
import { cargarOpciones, REPOS } from "@/lib/catalogos/repos";
import { consultar, SinPermiso } from "@/lib/db";

export default async function PaginaNuevo({ params }: PageProps<"/catalogos/[slug]/nuevo">) {
  const { slug } = await params;
  const def = catalogoPorSlug(slug);
  if (!def || !REPOS[slug]) notFound();

  // Dar de alta es escribir, así que la lectura exige el permiso de escritura:
  // no hay versión de solo lectura de un formulario de alta. `consultar` lanza
  // antes de ejecutar el callback, así que ni siquiera se cargan las opciones.
  let opciones;
  try {
    opciones = await consultar(def.permisoEscritura, (db) =>
      necesitaOpciones(def) ? cargarOpciones(db) : Promise.resolve({}),
    );
  } catch (error) {
    if (!(error instanceof SinPermiso)) throw error;
    return (
      <>
        <EncabezadoPagina titulo={def.titulo} />
        <Card className="max-w-3xl">
          <EstadoVacio
            titulo={`No puedes dar de alta ${def.titulo.toLowerCase()}`}
            descripcion="Tu rol permite consultar este catálogo, no modificarlo."
          />
        </Card>
      </>
    );
  }

  // Un registro nuevo nace activo: es lo que espera quien lo está dando de alta.
  const valores: ValoresFormulario = {};
  for (const campo of def.campos) {
    valores[campo.nombre] = campo.esEstado ? true : campo.tipo === "booleano" ? false : "";
  }

  return (
    <>
      <EncabezadoPagina titulo={`Nuev${def.genero === "f" ? "a" : "o"} ${def.singular}`} />
      <Card className="max-w-3xl">
        <CardHeader
          titulo={`Datos ${def.genero === "f" ? "de la" : "del"} ${def.singular}`}
          descripcion={`Se agregará a la lista de ${def.titulo.toLowerCase()}.`}
        />
        <FormularioCatalogo
          def={def}
          modo="alta"
          opciones={opciones}
          valores={valores}
          accion={guardarCatalogo.bind(null, slug, null)}
          textoGuardar="Guardar"
        />
      </Card>
    </>
  );
}
