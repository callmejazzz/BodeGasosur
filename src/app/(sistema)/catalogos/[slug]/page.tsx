import { notFound } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { Input } from "@/components/ui/campos";
import { Badge, Card, EncabezadoPagina, EstadoVacio } from "@/components/ui/superficies";
import { Tabla, Td, Th, Tr } from "@/components/ui/tabla";
import {
  catalogoPorSlug,
  type CampoDef,
  type CatalogoDef,
} from "@/lib/catalogos/definiciones";
import { leerRuta, REPOS } from "@/lib/catalogos/repos";
import { consultar } from "@/lib/db";
import { rolTienePermiso } from "@/lib/permisos";
import { cantidad, cn } from "@/lib/utils";

function celda(registro: { id: string }, campo: CampoDef, def: CatalogoDef) {
  const valor = leerRuta(registro, campo.rutaTabla ?? campo.nombre);

  if (campo.esEstado) {
    const terminacion = def.genero === "f" ? "a" : "o";
    return valor === true ? (
      <Badge tono="exito">{`Activ${terminacion}`}</Badge>
    ) : (
      <Badge tono="neutro">{`Inactiv${terminacion}`}</Badge>
    );
  }

  if (campo.tipo === "booleano") {
    return valor === true ? <Badge tono="info">Sí</Badge> : <span className="text-muted">No</span>;
  }

  if (campo.tipo === "numero") {
    // Nulo no es cero: «sin piezas por caja» significa que no aplica, y
    // enseñarlo como 0 le diría a Compras que la caja viene vacía.
    if (valor === null || valor === undefined || valor === "") {
      return <span className="text-muted">—</span>;
    }
    return <span className="tabular">{cantidad(valor)}</span>;
  }

  if (valor === null || valor === undefined || valor === "") {
    return <span className="text-muted">—</span>;
  }

  return String(valor);
}

export default async function PaginaCatalogo({
  params,
  searchParams,
}: PageProps<"/catalogos/[slug]">) {
  const { slug } = await params;
  const { q } = await searchParams;
  const def = catalogoPorSlug(slug);
  const repo = REPOS[slug];
  if (!def || !repo) notFound();

  const busqueda = typeof q === "string" ? q.trim().toLowerCase() : "";
  // El permiso de escritura sale del mismo `usuario` que `consultar` ya entrega:
  // ni segunda lectura de sesión ni consulta extra.
  const { todos, puedeEscribir } = await consultar("catalogos:leer", async (db, usuario) => ({
    todos: await repo.listar(db),
    puedeEscribir: rolTienePermiso(usuario.rol, def.permisoEscritura),
  }));

  const registros = busqueda
    ? todos.filter((r) =>
        def.camposBusqueda.some((campo) =>
          String(leerRuta(r, campo) ?? "")
            .toLowerCase()
            .includes(busqueda),
        ),
      )
    : todos;

  const columnas = def.campos.filter((c) => !c.ocultarEnTabla);

  return (
    <>
      <EncabezadoPagina
        titulo={def.titulo}
        descripcion={def.descripcion}
        acciones={
          puedeEscribir ? (
            <ButtonLink href={`/catalogos/${slug}/nuevo`} prefetch={false}>
              Nuev{def.genero === "f" ? "a" : "o"} {def.singular}
            </ButtonLink>
          ) : undefined
        }
      />

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
          <form className="flex items-center gap-2">
            <Input
              name="q"
              defaultValue={busqueda}
              placeholder={`Buscar en ${def.titulo.toLowerCase()}…`}
              className="h-8 w-64"
              aria-label={`Buscar en ${def.titulo}`}
            />
          </form>
          <p className="text-sm text-muted tabular">
            {registros.length} de {todos.length} registros
          </p>
        </div>

        {registros.length === 0 ? (
          <EstadoVacio
            titulo={busqueda ? "Sin coincidencias" : `Todavía no hay ${def.titulo.toLowerCase()}`}
            descripcion={
              busqueda
                ? "Prueba con otra búsqueda o limpia el filtro."
                : puedeEscribir
                  ? `Da de alta ${def.genero === "f" ? "la primera" : "el primero"} para empezar.`
                  : "Nadie ha dado de alta ninguno todavía."
            }
            accion={
              !busqueda && puedeEscribir ? (
                <ButtonLink href={`/catalogos/${slug}/nuevo`} tamano="sm" prefetch={false}>
                  Agregar
                </ButtonLink>
              ) : undefined
            }
          />
        ) : (
          <Tabla>
            <thead>
              <tr>
                {columnas.map((c) => (
                  <Th
                    key={c.nombre}
                    className={c.alineacion === "derecha" ? "text-right" : undefined}
                  >
                    {c.etiqueta}
                  </Th>
                ))}
                <Th className="w-24 text-right">Acciones</Th>
              </tr>
            </thead>
            <tbody>
              {registros.map((registro) => (
                <Tr key={registro.id}>
                  {columnas.map((c) => (
                    <Td
                      key={c.nombre}
                      className={cn(
                        c.alineacion === "derecha" && "text-right",
                        c.sinSalto && "font-medium whitespace-nowrap",
                      )}
                    >
                      {celda(registro, c, def)}
                    </Td>
                  ))}
                  <Td className="text-right">
                    <ButtonLink
                      href={`/catalogos/${slug}/${registro.id}`}
                      variante="sutil"
                      tamano="sm"
                      prefetch={false}
                    >
                      {puedeEscribir ? "Editar" : "Ver"}
                    </ButtonLink>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Tabla>
        )}
      </Card>
    </>
  );
}
