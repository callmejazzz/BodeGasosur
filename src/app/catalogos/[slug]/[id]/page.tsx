import { notFound } from "next/navigation";
import { guardarCatalogo } from "../actions";
import { FormularioCatalogo } from "@/components/catalogos/formulario-catalogo";
import type { ValoresFormulario } from "@/lib/catalogos/formulario";
import { Card, CardHeader, EncabezadoPagina } from "@/components/ui/superficies";
import { catalogoPorSlug } from "@/lib/catalogos/definiciones";
import { cargarOpciones, leerRuta, REPOS } from "@/lib/catalogos/repos";
import { aNumero } from "@/lib/utils";

export default async function PaginaEditar({ params }: PageProps<"/catalogos/[slug]/[id]">) {
  const { slug, id } = await params;
  const def = catalogoPorSlug(slug);
  const repo = REPOS[slug];
  if (!def || !repo) notFound();

  const [registro, opciones] = await Promise.all([repo.obtener(id), cargarOpciones()]);
  if (!registro) notFound();

  const valores: ValoresFormulario = {};
  for (const campo of def.campos) {
    const valor = leerRuta(registro, campo.nombre);
    if (campo.tipo === "booleano") {
      valores[campo.nombre] = valor === true;
    } else if (campo.tipo === "numero") {
      valores[campo.nombre] = String(aNumero(valor));
    } else {
      valores[campo.nombre] = valor === null || valor === undefined ? "" : String(valor);
    }
  }

  const titulo = String(leerRuta(registro, def.campoTitulo) ?? def.singular);

  return (
    <>
      <EncabezadoPagina titulo={titulo} descripcion={`Editando ${def.singular}`} />
      <Card className="max-w-3xl">
        <CardHeader
          titulo={`Datos ${def.genero === "f" ? "de la" : "del"} ${def.singular}`}
          descripcion="Los cambios afectan las capturas futuras; los movimientos ya registrados conservan lo que se guardó en su momento."
        />
        <FormularioCatalogo
          def={def}
          modo="edicion"
          opciones={opciones}
          valores={valores}
          accion={guardarCatalogo.bind(null, slug, id)}
          textoGuardar="Guardar cambios"
        />
      </Card>
    </>
  );
}
