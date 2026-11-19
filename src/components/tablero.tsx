import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { BadgeEstatus } from "@/components/entradas/detalle-entrada";
import { BadgeDevolucion, BadgeEstatusSalida } from "@/components/salidas/estatus-salida";
import { filaDeSalida } from "@/components/salidas/filas";
import { ButtonLink } from "@/components/ui/button";
import { Badge, Card, CardHeader, EstadoVacio } from "@/components/ui/superficies";
import { Tabla, Td, Th, Tr } from "@/components/ui/tabla";
import { formatearFecha } from "@/lib/fechas";
import { ENLACES, type Tablero } from "@/lib/tablero/repo";
import { cantidad, cn, moneda } from "@/lib/utils";

type Columna = { titulo: string; derecha?: boolean };

// Alinea la tabla con el encabezado de la tarjeta y quita la raya bajo la última fila
const TABLA = "[&_tbody_tr:last-child_td]:border-b-0 [&_td:first-child]:pl-5 [&_th:first-child]:pl-5 [&_td:last-child]:pr-5 [&_th:last-child]:pr-5";

// En % del ancho de la tarjeta, por pantalla (lg ≥ 1024 px, xl ≥ 1280 px, 2xl ≥ 1536 px); en lg, más de 10 % la desborda
const MARGEN_GASTO = "lg:w-[10%] xl:w-[15%] 2xl:w-[5%]";

// Debajo de lg las tarjetas van apiladas y no hay columnas vacías
const HUECO = "hidden p-0! lg:table-cell";
// Con columnas vacías, la primera y la última con datos se alinean con el encabezado de la tarjeta
const TABLA_CON_HUECOS = "[&_td:nth-child(2)]:pl-5 [&_th:nth-child(2)]:pl-5 [&_td:nth-last-child(2)]:pr-5 [&_th:nth-last-child(2)]:pr-5";

function Tarjeta({ titulo, enlace, columnas, vacio, className, margen, children }: {
  titulo: string;
  enlace: { href: string; texto: string };
  columnas: Columna[];
  vacio: string | null;
  className?: string;
  margen?: string;
  children: ReactNode;
}) {
  return (
    <Card className={cn("flex min-w-0 flex-col", className)}>
      <CardHeader
        titulo={titulo}
        acciones={
          <ButtonLink href={enlace.href} variante="secundario" tamano="sm">
            {enlace.texto}
            <ChevronRight aria-hidden className="-mr-1 size-4" />
          </ButtonLink>
        }
      />
      {vacio ? (
        <EstadoVacio titulo={vacio} />
      ) : (
        <Tabla className={cn(TABLA, margen && TABLA_CON_HUECOS)}>
          <thead>
            <tr>
              {margen && <Th aria-hidden className={cn(HUECO, margen)} />}
              {columnas.map((c) => (
                <Th key={c.titulo} className={c.derecha ? "text-right" : undefined}>{c.titulo}</Th>
              ))}
              {margen && <Th aria-hidden className={cn(HUECO, margen)} />}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </Tabla>
      )}
    </Card>
  );
}

function Abrir({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="font-medium text-primary hover:underline">{children}</Link>;
}

const FECHA_BODEGA_ESTATUS: Columna[] = [{ titulo: "Fecha" }, { titulo: "Bodega / Estación" }, { titulo: "Estatus" }];

export function TarjetaExistencias({ filas }: { filas: NonNullable<Tablero["existencias"]> }) {
  return (
    <Tarjeta
      titulo="Existencias"
      enlace={{ href: ENLACES.existencias, texto: "Ver existencias" }}
      columnas={[{ titulo: "Artículo" }, { titulo: "Bodega" }, { titulo: "Existencia", derecha: true }]}
      vacio={filas.length === 0 ? "Aún no hay artículos bajo mínimo" : null}
    >
      {filas.map((f) => (
        <Tr key={f.id}>
          <Td>{f.descripcion}</Td>
          <Td>{f.nombreBodega}</Td>
          <Td className="text-right whitespace-nowrap tabular">{`${cantidad(f.existencia)} de ${cantidad(f.minimo)} ${f.unidad}`}</Td>
        </Tr>
      ))}
    </Tarjeta>
  );
}

export function TarjetaSalidas({ filas }: { filas: NonNullable<Tablero["salidas"]> }) {
  return (
    <Tarjeta
      titulo="Salidas"
      enlace={{ href: ENLACES.salidas, texto: "Ver salidas" }}
      columnas={FECHA_BODEGA_ESTATUS}
      vacio={filas.length === 0 ? "Aún no hay salidas por revisar" : null}
    >
      {filas.map((f) => filaDeSalida(f)).map((s) => (
        <Tr key={s.id}>
          <Td className="whitespace-nowrap"><Abrir href={`/salidas/${s.id}`}>{s.fecha}</Abrir></Td>
          <Td>{`${s.bodega} / ${s.estacion}`}</Td>
          <Td><BadgeEstatusSalida estatus={s.estatus} /></Td>
        </Tr>
      ))}
    </Tarjeta>
  );
}

export function TarjetaPrestamos({ filas }: { filas: NonNullable<Tablero["prestamos"]> }) {
  return (
    <Tarjeta
      titulo="Préstamos"
      enlace={{ href: ENLACES.prestamos, texto: "Ver préstamos" }}
      columnas={FECHA_BODEGA_ESTATUS}
      vacio={filas.length === 0 ? "Aún no hay préstamos abiertos" : null}
    >
      {filas.map((p) => (
        <Tr key={p.id}>
          <Td className="whitespace-nowrap"><Abrir href={`/salidas/${p.id}`}>{formatearFecha(p.fecha)}</Abrir></Td>
          <Td>{`${p.bodega} / ${p.estacion}`}</Td>
          <Td>{p.devuelto > 0 ? <BadgeDevolucion estado="parcial" /> : <Badge tono="info">Abierto</Badge>}</Td>
        </Tr>
      ))}
    </Tarjeta>
  );
}

export function TarjetaEntradas({ filas }: { filas: NonNullable<Tablero["entradas"]> }) {
  return (
    <Tarjeta
      titulo="Entradas"
      enlace={{ href: ENLACES.entradas, texto: "Ver entradas" }}
      columnas={[{ titulo: "Fecha" }, { titulo: "Bodega" }, { titulo: "Estatus" }]}
      vacio={filas.length === 0 ? "No hay entradas en borrador" : null}
    >
      {filas.map((e) => (
        <Tr key={e.id}>
          <Td className="whitespace-nowrap"><Abrir href={`/entradas/${e.id}`}>{formatearFecha(e.fecha)}</Abrir></Td>
          <Td>{e.bodegaDestino?.nombre ?? "—"}</Td>
          <Td><BadgeEstatus estatus={e.estatus} /></Td>
        </Tr>
      ))}
    </Tarjeta>
  );
}

const importe = (valor: string | null) => (valor === null ? "—" : moneda(valor));

export function TarjetaGasto({ datos }: { datos: NonNullable<Tablero["gasto"]> }) {
  const { filtros, estaciones } = datos;
  const periodo = `${formatearFecha(filtros.desde)} a ${formatearFecha(filtros.hasta)}`;
  const hueco = <Td aria-hidden className={cn(HUECO, MARGEN_GASTO)} />;
  return (
    <Tarjeta
      titulo="Gasto mensual por estación"
      enlace={{ href: ENLACES.gasto(filtros), texto: "Ver gastos" }}
      columnas={[{ titulo: "Fecha" }, { titulo: "Estación" }, { titulo: "Total sin IVA", derecha: true }]}
      vacio={estaciones.length === 0 ? "Todavía no hay movimientos este mes" : null}
      className="lg:col-span-2"
      margen={MARGEN_GASTO}
    >
      {estaciones.map((s) => (
        <Tr key={s.id}>
          {hueco}
          <Td className="whitespace-nowrap">{periodo}</Td>
          <Td>{s.alias}</Td>
          <Td className="text-right whitespace-nowrap tabular">
            {importe(s.importe)}
            {s.articulosSinCosto > 0 && <span className="block text-xs text-warning">Hay piezas sin costo</span>}
          </Td>
          {hueco}
        </Tr>
      ))}
    </Tarjeta>
  );
}
