import Link from "next/link";
import { BadgeEstatus } from "@/components/inventario/estatus";
import { Badge } from "@/components/ui/superficies";
import { Tabla, Td, Th, Tr } from "@/components/ui/tabla";
import { formatearFecha, formatearInstante } from "@/lib/fechas";
import { rutaDeMovimiento, type MovimientoDetalle, type Valuacion, type ValuacionMovimiento } from "@/lib/inventario/repo";
import { cantidad, moneda } from "@/lib/utils";

const formateadorCosto = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2, maximumFractionDigits: 4 });
const costo = (valor: unknown) => (valor === null || valor === undefined ? "sin costo" : formateadorCosto.format(Number(String(valor))));

type Referencia = { id: string; folio: string | null; tipo: Parameters<typeof rutaDeMovimiento>[0] } | null | undefined;

export function EnlaceMovimiento({ m }: { m: Referencia }) {
  if (!m) return null;
  return (
    <Link href={rutaDeMovimiento(m.tipo, m.id)} className="font-medium text-primary hover:underline">
      {m.folio ?? "sin folio"}
    </Link>
  );
}

function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="mb-1 text-xs font-medium tracking-wide text-muted uppercase">{etiqueta}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  );
}

const DeBaja = ({ activa }: { activa: boolean | undefined }) => (activa === false ? <span className="ml-2"><Badge tono="aviso">Dada de baja</Badge></span> : null);

export function EncabezadoMovimiento({ m }: { m: MovimientoDetalle }) {
  return (
    <dl className="grid gap-x-8 gap-y-5 px-5 py-5 sm:grid-cols-2 lg:grid-cols-4">
      <Dato etiqueta="Estatus">
        <BadgeEstatus estatus={m.estatus} revertido={!!m.canceladoPor} esReversa={!!m.cancelaA} />
      </Dato>
      <Dato etiqueta="Folio">{m.folio ?? <span className="text-muted">Sin folio</span>}</Dato>
      <Dato etiqueta={m.estatus === "CONFIRMADO" ? "Fecha" : "Fecha provisional"}>{formatearFecha(m.fecha)}</Dato>
      {m.bodegaOrigen && (
        <Dato etiqueta={m.tipo === "AJUSTE" ? "Bodega (resta)" : "Bodega origen"}>
          {m.bodegaOrigen.nombre}
          <DeBaja activa={m.bodegaOrigen.activa} />
        </Dato>
      )}
      {m.bodegaDestino && (
        <Dato etiqueta={m.tipo === "AJUSTE" ? "Bodega (suma)" : m.tipo === "DEVOLUCION" ? "Bodega que recibe" : "Bodega destino"}>
          {m.bodegaDestino.nombre}
          <DeBaja activa={m.bodegaDestino.activa} />
        </Dato>
      )}
      {m.estacion && (
        <Dato etiqueta="Estación">
          {m.estacion.numero} · {m.estacion.alias}
          <DeBaja activa={m.estacion.activa} />
        </Dato>
      )}
      {m.tipo === "DEVOLUCION" && (
        <Dato etiqueta="Salida">
          {m.devuelveA ? <EnlaceMovimiento m={m.devuelveA} /> : <Badge tono="aviso">Sin salida: procedencia no comprobada</Badge>}
        </Dato>
      )}
      {m.motivo && <Dato etiqueta="Motivo">{m.motivo}</Dato>}
      {m.conteo && (
        <Dato etiqueta="Hoja de conteo">
          <Link href={`/conteos/${m.conteo.id}`} className="font-medium text-primary hover:underline">Ver hoja</Link>
        </Dato>
      )}
      {m.cancelaA && (
        <Dato etiqueta="Revierte a">
          <EnlaceMovimiento m={m.cancelaA} />
        </Dato>
      )}
      {m.observaciones && <Dato etiqueta="Observaciones">{m.observaciones}</Dato>}
    </dl>
  );
}

/** Cada partida con su rastro: de qué capa salió, a cuál entró y a cuál volvió cada pieza. */
export function PartidasMovimiento({ m, existencias, pendientes }: { m: MovimientoDetalle; existencias?: Record<string, number> | null; pendientes?: Record<string, number> | null }) {
  const columnas = 4 + (existencias ? 1 : 0) + (pendientes ? 1 : 0);
  return (
    <Tabla>
      <thead>
        <tr>
          <Th>Artículo</Th>
          <Th className="text-right">Capturado</Th>
          <Th className="text-right">Unidades base</Th>
          {existencias && <Th className="text-right">En origen</Th>}
          {pendientes && <Th className="text-right">Falta por volver</Th>}
          <Th>Observaciones</Th>
        </tr>
      </thead>
      <tbody>
        {m.partidas.map((p) => {
          const unidad = p.articulo.unidad.clave;
          const hay = existencias ? (existencias[p.articuloId] ?? 0) : null;
          const falta = pendientes ? (pendientes[p.articuloId] ?? 0) : null;
          const entradas = m.capas.filter((c) => c.articuloId === p.articuloId);
          const rastro = [
            ...p.consumos.map((c) => ({ clave: `s${c.capa.fechaOriginal.toISOString()}${c.capa.movimiento.id}`, texto: `Salió ${cantidad(c.cantidad)} ${unidad} de la capa del ${formatearFecha(c.capa.fechaOriginal)} en ${c.capa.bodega.nombre}`, ref: c.capa.movimiento, costo: c })),
            ...entradas.map((c, i) => ({ clave: `e${i}`, texto: `Entró ${cantidad(c.cantidadInicial)} ${unidad} como capa del ${formatearFecha(c.fechaOriginal)}`, ref: c.origen?.movimiento ?? null, costo: c })),
            ...p.restituciones.map((r) => ({ clave: `r${r.capa.fechaOriginal.toISOString()}${r.capa.movimiento.id}`, texto: `Volvió ${cantidad(r.cantidad)} ${unidad} a la capa del ${formatearFecha(r.capa.fechaOriginal)} en ${r.capa.bodega.nombre}`, ref: r.capa.movimiento, costo: r })),
          ];
          return (
            <PartidaConRastro key={p.id} rastro={rastro} columnas={columnas}>
              <Td className="whitespace-nowrap">
                <span className="font-medium">{p.articulo.clave}</span> <span className="text-muted">{p.articulo.descripcion}</span>
                {!p.articulo.activo && <span className="ml-2"><Badge tono="aviso">Dado de baja</Badge></span>}
              </Td>
              <Td className="text-right tabular whitespace-nowrap">
                {cantidad(p.cantidadCapturada)} {p.presentacionCapturada === "CAJA" ? `caja${p.cantidadCapturada === 1 ? "" : "s"} × ${p.factorConversion}` : unidad}
              </Td>
              <Td className="text-right tabular whitespace-nowrap">{cantidad(p.cantidad)} {unidad}</Td>
              {hay !== null && (
                <Td className="text-right tabular whitespace-nowrap">
                  {cantidad(hay)} {unidad}
                  {hay < p.cantidad && <span className="ml-2"><Badge tono="peligro">No alcanza</Badge></span>}
                </Td>
              )}
              {falta !== null && (
                <Td className="text-right tabular whitespace-nowrap">
                  {cantidad(falta)} {unidad}
                  {falta < p.cantidad && <span className="ml-2"><Badge tono="peligro">Excede</Badge></span>}
                </Td>
              )}
              <Td className="text-muted">{p.observaciones ?? "—"}</Td>
            </PartidaConRastro>
          );
        })}
      </tbody>
    </Tabla>
  );
}

type Rastro = { clave: string; texto: string; ref: Referencia; costo: { costoUnitario: unknown; costoUnitarioConIva: unknown } };

function PartidaConRastro({ rastro, columnas, children }: { rastro: Rastro[]; columnas: number; children: React.ReactNode }) {
  return (
    <>
      <Tr>{children}</Tr>
      {rastro.length > 0 && (
        <tr>
          <td colSpan={columnas} className="border-b border-border bg-surface-muted/40 px-4 py-2">
            <ul className="space-y-0.5 text-xs text-muted-strong">
              {rastro.map((r) => (
                <li key={r.clave} className="tabular">
                  {r.texto}
                  {r.ref && <> (<EnlaceMovimiento m={r.ref} />)</>} · {costo(r.costo.costoUnitario)}
                  {r.costo.costoUnitarioConIva !== null && ` · ${costo(r.costo.costoUnitarioConIva)} con IVA`}
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}

function Importe({ etiqueta, v }: { etiqueta: string; v: Valuacion }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
      <dt className="text-muted">{etiqueta}</dt>
      <dd className="tabular">
        <span className="font-medium">{v.importe === null ? "—" : moneda(v.importe)}</span>
        <span className="text-muted"> · {v.importeConIva === null ? "—" : moneda(v.importeConIva)} con IVA</span>
        {v.piezasSinCosto > 0 && <span className="text-muted"> · {cantidad(v.piezasSinCosto)} piezas sin costo, fuera del importe</span>}
      </dd>
    </div>
  );
}

const hayAlgo = (v: Valuacion) => v.importe !== null || v.piezasSinCosto > 0;

/** Lo que valió cada lado del asiento, sumando por renglón en PostgreSQL. Un traspaso sale y entra por lo mismo. */
export function ValuacionDeMovimiento({ v }: { v: ValuacionMovimiento }) {
  if (!hayAlgo(v.salio) && !hayAlgo(v.entro) && !hayAlgo(v.volvio)) return null;
  return (
    <dl className="flex flex-col gap-2 border-t border-border px-5 py-4 text-sm">
      {hayAlgo(v.salio) && <Importe etiqueta="Salió" v={v.salio} />}
      {hayAlgo(v.entro) && <Importe etiqueta="Entró" v={v.entro} />}
      {hayAlgo(v.volvio) && <Importe etiqueta="Volvió a sus capas" v={v.volvio} />}
    </dl>
  );
}

type Paso = { etiqueta: string; quien: string; cuando: Date; detalle?: React.ReactNode };

/** Quién hizo cada paso y cuándo; el actor sale siempre de la sesión. */
export function Historial({ pasos }: { pasos: Paso[] }) {
  return (
    <ol className="divide-y divide-border">
      {pasos.map((p, i) => (
        <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 py-3 text-sm">
          <span>
            <span className="font-medium text-foreground">{p.etiqueta}</span> <span className="text-muted">{p.quien}</span>
            {p.detalle && <span className="block text-muted-strong">{p.detalle}</span>}
          </span>
          <span className="tabular text-muted">{formatearInstante(p.cuando)}</span>
        </li>
      ))}
    </ol>
  );
}

type Reversa = { id: string; folio: string | null; tipo: Parameters<typeof rutaDeMovimiento>[0]; motivo: string | null; confirmadoEn: Date | null; creadoPor: { correo: string } } | null;

export function pasosDeMovimiento(m: MovimientoDetalle, reversa: Reversa): Paso[] {
  const pasos: Paso[] = [{ etiqueta: m.cancelaA ? "Revirtió" : "Capturó", quien: m.creadoPor.correo, cuando: m.createdAt, detalle: m.cancelaA ? m.motivo : null }];
  if (m.confirmadoPor && m.confirmadoEn && !m.cancelaA) pasos.push({ etiqueta: "Confirmó", quien: m.confirmadoPor.correo, cuando: m.confirmadoEn });
  if (m.canceladoPorUsuario && m.canceladoEn) pasos.push({ etiqueta: "Descartó", quien: m.canceladoPorUsuario.correo, cuando: m.canceladoEn, detalle: m.motivoCancelacion });
  return [...pasos, ...pasosDeReversa(reversa)];
}

export function pasosDeReversa(reversa: Reversa): Paso[] {
  if (!reversa?.confirmadoEn) return [];
  return [{ etiqueta: "Revirtió", quien: reversa.creadoPor.correo, cuando: reversa.confirmadoEn, detalle: <>Con <EnlaceMovimiento m={reversa} />{reversa.motivo ? `: ${reversa.motivo}` : ""}</> }];
}
