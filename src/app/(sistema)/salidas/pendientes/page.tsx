import { SeccionPendientes } from "@/components/salidas/pendientes";
import { ButtonLink } from "@/components/ui/button";
import { Card, EncabezadoPagina, EstadoVacio } from "@/components/ui/superficies";
import { consultar } from "@/lib/db";
import { leerPagina, parametrosDePaginas } from "@/lib/paginacion";
import { bandejaDeSalidas, SECCIONES } from "@/lib/salidas/repo";

export const dynamic = "force-dynamic";

export default async function PaginaPendientes({ searchParams }: PageProps<"/salidas/pendientes">) {
  // Cada sección pagina por su cuenta: ?porAutorizar=2&porRecibir=3
  const params = await searchParams;
  const paginas = Object.fromEntries(SECCIONES.map(({ clave }) => [clave, leerPagina(params[clave])]));
  // Solo se consultan las secciones en las que el usuario puede actuar.
  const secciones = await consultar("salidas:leer", (db, usuario) => bandejaDeSalidas(db, usuario, paginas));
  const parametros = parametrosDePaginas(Object.fromEntries(secciones.map((s) => [s.clave, s.pagina])));

  return (
    <>
      <EncabezadoPagina
        titulo="Salidas pendientes"
        descripcion="Lo que espera tu autorización, el retiro o la confirmación de recepción, lo más antiguo primero."
        acciones={<ButtonLink href="/salidas" variante="secundario">Todas las salidas</ButtonLink>}
      />

      {secciones.length === 0 ? (
        <Card>
          <EstadoVacio
            titulo="No tienes pendientes que atender"
            descripcion="Tu cuenta puede consultar salidas, pero no autorizarlas, retirarlas ni confirmar su recepción."
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {secciones.map((s) => (
            <SeccionPendientes key={s.clave} seccion={s} parametros={parametros} />
          ))}
        </div>
      )}
    </>
  );
}
