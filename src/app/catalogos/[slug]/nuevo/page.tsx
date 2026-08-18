import { notFound } from "next/navigation";
import { guardarCatalogo } from "../actions";
import { FormularioCatalogo } from "@/components/catalogos/formulario-catalogo";
import type { ValoresFormulario } from "@/lib/catalogos/formulario";
import { Card, CardHeader, EncabezadoPagina } from "@/components/ui/superficies";
import { catalogoPorSlug, elLa } from "@/lib/catalogos/definiciones";
import { cargarOpciones, REPOS } from "@/lib/catalogos/repos";

export default async function PaginaNuevo({ params }: PageProps<"/catalogos/[slug]/nuevo">) {
  const { slug } = await params;
  const def = catalogoPorSlug(slug);
  if (!def || !REPOS[slug]) notFound();

  const opciones = await cargarOpciones();

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
          descripcion={`Se agregará a ${elLa(def)} lista de ${def.titulo.toLowerCase()}.`}
        />
        <FormularioCatalogo
          def={def}
          opciones={opciones}
          valores={valores}
          accion={guardarCatalogo.bind(null, slug, null)}
          textoGuardar="Guardar"
        />
      </Card>
    </>
  );
}
