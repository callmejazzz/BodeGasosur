import Link from "next/link";
import { Badge } from "@/components/ui/superficies";
import { Tabla, Td, Th, Tr } from "@/components/ui/tabla";
import { formatearFecha, formatearInstante } from "@/lib/fechas";
import type { EntradaDetalle, EntradaResumen } from "@/lib/entradas/repo";
import { cantidad, decimalEnTexto } from "@/lib/utils";

const TONO_ESTATUS = { BORRADOR: "aviso", CONFIRMADO: "exito", CANCELADO: "neutro" } as const;
const TEXTO_ESTATUS = { BORRADOR: "Borrador", CONFIRMADO: "Confirmada", CANCELADO: "Descartada" } as const;

export function BadgeEstatus({ estatus }: { estatus: string }) {
  const clave = estatus as keyof typeof TONO_ESTATUS;
  return <Badge tono={TONO_ESTATUS[clave] ?? "neutro"}>{TEXTO_ESTATUS[clave] ?? estatus}</Badge>;
}

/** Importe con dos decimales, y hasta `decimales` solo cuando no son cero. Los Decimal de Prisma llegan como objeto. */
function importe(valor: unknown, moneda: string, decimales = 2) {
  if (valor === null || valor === undefined) return "—";
  return `${new Intl.NumberFormat("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: decimales }).format(Number(String(valor)))} ${moneda}`;
}

function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="mb-1 text-xs font-medium tracking-wide text-muted uppercase">{etiqueta}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  );
}

export function EncabezadoEntrada({ entrada }: { entrada: EntradaDetalle }) {
  const m = entrada.moneda ?? "MXN";
  return (
    <dl className="grid gap-x-8 gap-y-5 px-5 py-5 sm:grid-cols-2 lg:grid-cols-4">
      <Dato etiqueta="Estatus"><BadgeEstatus estatus={entrada.estatus} /></Dato>
      <Dato etiqueta="Folio">{entrada.folio ?? <span className="text-muted">Sin folio (borrador)</span>}</Dato>
      <Dato etiqueta="Fecha de recepción">{formatearFecha(entrada.fecha)}</Dato>
      <Dato etiqueta="Factura o remisión">{entrada.referencia ?? <span className="text-muted">—</span>}</Dato>
      <Dato etiqueta="Proveedor">
        {entrada.proveedor?.nombreComercial ?? "—"}
        {entrada.proveedor && !entrada.proveedor.activo && <span className="ml-2"><Badge tono="aviso">Dado de baja</Badge></span>}
      </Dato>
      <Dato etiqueta="Bodega destino">
        {entrada.bodegaDestino ? `${entrada.bodegaDestino.clave} · ${entrada.bodegaDestino.nombre}` : "—"}
        {entrada.bodegaDestino && !entrada.bodegaDestino.activa && <span className="ml-2"><Badge tono="aviso">Dada de baja</Badge></span>}
      </Dato>
      <Dato etiqueta="Moneda">{m}{entrada.tipoCambio ? ` · ${decimalEnTexto(entrada.tipoCambio)} MXN por USD` : ""}</Dato>
      <Dato etiqueta="Capturó">{entrada.creadoPor.correo} · {formatearInstante(entrada.createdAt)}</Dato>
      {entrada.estatus === "CONFIRMADO" && entrada.confirmadoPor && entrada.confirmadoEn && (
        <Dato etiqueta="Recibió y confirmó">{entrada.confirmadoPor.correo} · {formatearInstante(entrada.confirmadoEn)}</Dato>
      )}
      {entrada.estatus === "CANCELADO" && entrada.canceladoPorUsuario && entrada.canceladoEn && (
        <Dato etiqueta="Descartó">{entrada.canceladoPorUsuario.correo} · {formatearInstante(entrada.canceladoEn)} · {entrada.motivoCancelacion}</Dato>
      )}
      {entrada.observaciones && <Dato etiqueta="Observaciones">{entrada.observaciones}</Dato>}
    </dl>
  );
}

/** `pie` va entre la tabla y los totales: la paginación de las partidas. Los totales son de toda la entrada. */
export function PartidasEntrada({ entrada, pie }: { entrada: EntradaDetalle; pie?: React.ReactNode }) {
  const m = entrada.moneda ?? "MXN";
  return (
    <>
      <Tabla>
        <thead>
          <tr>
            <Th>Artículo</Th>
            <Th className="text-right">Capturado</Th>
            <Th className="text-right">Unidades base</Th>
            <Th className="text-right">Costo capturado ({m})</Th>
            <Th className="text-right">IVA</Th>
            <Th className="text-right">Costo base (MXN)</Th>
            <Th className="text-right">Con IVA (MXN)</Th>
            <Th>Serie / obs.</Th>
          </tr>
        </thead>
        <tbody>
          {entrada.partidas.map((p) => (
            <Tr key={p.id}>
              <Td className="whitespace-nowrap">
                <span className="font-medium">{p.articulo.clave}</span> <span className="text-muted">{p.articulo.descripcion}</span>
                {!p.articulo.activo && <span className="ml-2"><Badge tono="aviso">Dado de baja</Badge></span>}
              </Td>
              <Td className="text-right tabular whitespace-nowrap">
                {cantidad(p.cantidadCapturada)} {p.presentacionCapturada === "CAJA" ? `caja${p.cantidadCapturada === 1 ? "" : "s"} × ${p.factorConversion}` : p.articulo.unidad.clave}
              </Td>
              <Td className="text-right tabular">{cantidad(p.cantidad)} {p.articulo.unidad.clave}</Td>
              <Td className="text-right tabular">{importe(p.costoUnitarioCapturado, "", 4)}</Td>
              <Td className="text-right tabular">{p.tasaIva ? `${Math.round(Number(String(p.tasaIva)) * 100)} %` : "—"}</Td>
              <Td className="text-right tabular">{importe(p.costoUnitario, "", 4)}</Td>
              <Td className="text-right tabular">{importe(p.costoUnitarioConIva, "", 4)}</Td>
              <Td className="text-muted">{[p.numeroSerie, p.observaciones].filter(Boolean).join(" · ") || "—"}</Td>
            </Tr>
          ))}
        </tbody>
      </Tabla>
      {pie}
      <dl className="grid gap-x-8 gap-y-2 border-t border-border px-5 py-4 text-sm sm:grid-cols-3">
        <div className="flex justify-between sm:block"><dt className="text-muted">Subtotal</dt><dd className="tabular font-medium">{importe(entrada.subtotal, m)}</dd></div>
        <div className="flex justify-between sm:block"><dt className="text-muted">IVA</dt><dd className="tabular font-medium">{importe(entrada.iva, m)}</dd></div>
        <div className="flex justify-between sm:block"><dt className="text-muted">Total</dt><dd className="tabular font-semibold">{importe(entrada.total, m)}</dd></div>
      </dl>
    </>
  );
}

export function EntradasRelacionadas({ entradas }: { entradas: EntradaResumen[] }) {
  if (entradas.length === 0) return null;
  return (
    <ul className="divide-y divide-border">
      {entradas.map((e) => (
        <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
          <Link href={`/entradas/${e.id}`} className="font-medium text-primary hover:underline">
            {e.folio ?? (e.estatus === "BORRADOR" ? "Borrador" : "Sin folio")} · {formatearFecha(e.fecha)}
          </Link>
          <span className="flex items-center gap-3">
            <span className="text-muted">{e._count.partidas} partida{e._count.partidas === 1 ? "" : "s"}</span>
            <span className="tabular">{importe(e.total, e.moneda ?? "MXN")}</span>
            <BadgeEstatus estatus={e.estatus} />
          </span>
        </li>
      ))}
    </ul>
  );
}
