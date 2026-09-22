import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { Badge, Card, CardHeader, EncabezadoPagina } from "@/components/ui/superficies";
import { Tabla, Td, Th, Tr } from "@/components/ui/tabla";
import { consultar } from "@/lib/db";
import { contarCatalogos } from "@/lib/catalogos/repos";
import { cantidad } from "@/lib/utils";

// El orden vigente está en docs/entregables-fases/README.md; el plan original
// está en docs/cimientos-word/04-plan-demo.docx. Si las listas se separan, esta es la que miente:
// el plan vive en el repositorio, no aquí.
const FASES = [
  { nombre: "Fase 0 y 1 — Cimientos y catálogos", detalle: "Next.js, PostgreSQL, Prisma y los catálogos con datos sembrados", estado: "lista" },
  { nombre: "Fase 2 — Cimientos corregidos", detalle: "Modelo de datos con los invariantes escritos en la base", estado: "lista" },
  { nombre: "Fase 3 — Usuarios y permisos", detalle: "Acceso con Clerk, roles y la facultad de autorizar", estado: "lista" },
  { nombre: "Fase 4 — Migración de catálogos (Plan B)", detalle: "Catálogo global real; proveedores, artículos y existencias los captura Compras", estado: "lista" },
  { nombre: "Fase 5 — Entradas", detalle: "Compras con moneda, IVA y capas de costo PEPS", estado: "lista" },
  { nombre: "Fase 6 — Salidas", detalle: "Solicitud, autorización, entrega y confirmación de recepción", estado: "pendiente" },
  { nombre: "Fase 7 — Traspasos, devoluciones y conteo", detalle: "Movimientos entre bodegas, préstamos e inventario físico", estado: "pendiente" },
  { nombre: "Fase 8 — Reportes", detalle: "Reporte de los viernes, kardex, gasto por estación y exportación", estado: "pendiente" },
  { nombre: "Fase 9 — Acabado", detalle: "Tablero, alertas de mínimos y diseño en celular", estado: "pendiente" },
] as const;

const ESTADO_FASE = {
  lista: { texto: "Lista", tono: "exito" },
  parcial: { texto: "Parcial", tono: "aviso" },
  pendiente: { texto: "Pendiente", tono: "neutro" },
} as const;

function Metrica({ etiqueta, valor, href }: { etiqueta: string; valor: number; href: string }) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-border bg-surface px-5 py-4 shadow-sm transition-colors hover:border-border-strong hover:bg-surface-muted"
    >
      <p className="text-sm text-muted">{etiqueta}</p>
      <p className="mt-1 text-2xl font-semibold tabular text-foreground">{cantidad(valor)}</p>
    </Link>
  );
}

// Lee existencias y catálogos en cada visita: son datos vivos, no contenido estático.
export const dynamic = "force-dynamic";

export default async function Tablero() {
  // Las tres lecturas comparten una instantánea: dentro de `consultar` corren
  // en una transacción REPEATABLE READ, así que los conteos y las listas no
  // pueden contradecirse entre sí.
  const [conteos, bodegas, articulosBajos] = await consultar("catalogos:leer", (db) =>
    Promise.all([
      contarCatalogos(db),
      db.bodega.findMany({ where: { activa: true }, orderBy: { clave: "asc" } }),
      db.articulo.findMany({
        where: { activo: true },
        orderBy: { clave: "asc" },
        include: { unidad: true, categoria: true },
        take: 8,
      }),
    ]),
  );

  return (
    <>
      <EncabezadoPagina
        titulo="Tablero"
        descripcion="Control de entradas, salidas y traspasos de material entre las bodegas y estaciones del grupo Gasosur."
        acciones={<ButtonLink href="/catalogos">Ver catálogos</ButtonLink>}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metrica etiqueta="Artículos" valor={conteos.articulos} href="/catalogos/articulos" />
        <Metrica etiqueta="Bodegas" valor={conteos.bodegas} href="/catalogos/bodegas" />
        <Metrica etiqueta="Estaciones" valor={conteos.estaciones} href="/catalogos/estaciones" />
        <Metrica etiqueta="Proveedores" valor={conteos.proveedores} href="/catalogos/proveedores" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            titulo="Avance de la demo"
            descripcion="Qué está construido y qué sigue, según el plan de fases."
          />
          <ul className="divide-y divide-border">
            {FASES.map((fase) => (
              <li key={fase.nombre} className="flex items-start justify-between gap-4 px-5 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{fase.nombre}</p>
                  <p className="text-sm text-muted">{fase.detalle}</p>
                </div>
                <Badge tono={ESTADO_FASE[fase.estado].tono}>{ESTADO_FASE[fase.estado].texto}</Badge>
              </li>
            ))}
          </ul>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader
              titulo="Bodegas activas"
              descripcion="Cada bodega llevará su propia existencia por artículo."
            />
            <Tabla>
              <thead>
                <tr>
                  <Th>Clave</Th>
                  <Th>Nombre</Th>
                  <Th>Ubicación</Th>
                </tr>
              </thead>
              <tbody>
                {bodegas.map((b) => (
                  <Tr key={b.id}>
                    <Td className="font-medium">{b.clave}</Td>
                    <Td>{b.nombre}</Td>
                    <Td className="text-muted">{b.ubicacion ?? "—"}</Td>
                  </Tr>
                ))}
              </tbody>
            </Tabla>
          </Card>

          <Card>
            <CardHeader
              titulo="Artículos de muestra"
              descripcion="Los stocks mínimos servirán de alerta cuando existan movimientos."
              acciones={
                <ButtonLink href="/catalogos/articulos" variante="secundario" tamano="sm">
                  Ver todos
                </ButtonLink>
              }
            />
            <Tabla>
              <thead>
                <tr>
                  <Th>Clave</Th>
                  <Th>Descripción</Th>
                  <Th className="text-right">Mínimo</Th>
                </tr>
              </thead>
              <tbody>
                {articulosBajos.map((a) => (
                  <Tr key={a.id}>
                    <Td className="font-medium whitespace-nowrap">{a.clave}</Td>
                    <Td>
                      <span className="block">{a.descripcion}</span>
                      <span className="text-xs text-muted">{a.categoria?.nombre ?? "Sin categoría"}</span>
                    </Td>
                    <Td className="text-right whitespace-nowrap tabular">
                      {cantidad(a.stockMinimo)} {a.unidad.clave}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Tabla>
          </Card>
        </div>
      </div>
    </>
  );
}
