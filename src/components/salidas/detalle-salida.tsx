import { BadgeEstatusSalida } from "@/components/salidas/estatus-salida";
import { Badge } from "@/components/ui/superficies";
import { Tabla, Td, Th, Tr } from "@/components/ui/tabla";
import { formatearFecha, formatearInstante } from "@/lib/fechas";
import type { SalidaDetalle, Valuacion } from "@/lib/salidas/repo";
import { cantidad, moneda } from "@/lib/utils";

const formateadorCosto = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2, maximumFractionDigits: 4 });

/** Costo unitario con hasta cuatro decimales; null es una capa sin costo. */
const costo = (valor: unknown) => (valor === null || valor === undefined ? "Sin costo" : formateadorCosto.format(Number(String(valor))));

function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="mb-1 text-xs font-medium tracking-wide text-muted uppercase">{etiqueta}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  );
}

const DeBaja = ({ activa, texto = "Dada de baja" }: { activa: boolean | undefined; texto?: string }) =>
  activa === false ? <span className="ml-2"><Badge tono="aviso">{texto}</Badge></span> : null;

export function EncabezadoSalida({ salida: s }: { salida: SalidaDetalle }) {
  const retirada = s.estatus === "RETIRADA" || s.estatus === "RECIBIDA";
  return (
    <dl className="grid gap-x-8 gap-y-5 px-5 py-5 sm:grid-cols-2 lg:grid-cols-4">
      <Dato etiqueta="Estatus">
        <span className="flex flex-wrap items-center gap-1.5">
          <BadgeEstatusSalida estatus={s.estatus} />
          {s.esPrestamo && <Badge>Préstamo</Badge>}
        </span>
      </Dato>
      <Dato etiqueta="Folio">{s.folio ?? <span className="text-muted">Sin folio</span>}</Dato>
      <Dato etiqueta={retirada ? "Fecha de salida" : "Fecha de solicitud"}>{formatearFecha(s.fecha)}</Dato>
      <Dato etiqueta="Bodega origen">
        {s.bodegaOrigen?.nombre ?? "—"}
        <DeBaja activa={s.bodegaOrigen?.activa} />
      </Dato>
      <Dato etiqueta="Estación destino">
        {s.estacion?.alias ?? "—"}
        <DeBaja activa={s.estacion?.activa} />
      </Dato>
      <Dato etiqueta="Área">
        {s.area?.nombre ?? <span className="text-muted">—</span>}
        <DeBaja activa={s.area?.activa} />
      </Dato>
      <Dato etiqueta="Solicitante">
        {s.solicitadoPor?.nombre ?? <span className="text-muted">—</span>}
        <DeBaja activa={s.solicitadoPor?.activa} texto="Dado de baja" />
      </Dato>
      {s.observaciones && <Dato etiqueta="Observaciones">{s.observaciones}</Dato>}
    </dl>
  );
}

/** Quién hizo cada paso y cuándo; el actor sale siempre de la sesión. */
export function HistorialSalida({ salida: s }: { salida: SalidaDetalle }) {
  const pasos: { etiqueta: string; quien: string; cuando: Date; detalle?: string | null }[] = [];
  if (s.creadoPor) pasos.push({ etiqueta: "Capturó", quien: s.creadoPor.correo, cuando: s.createdAt });
  if (s.autorizadoPor && s.autorizadoEn) pasos.push({ etiqueta: "Autorizó", quien: s.autorizadoPor.correo, cuando: s.autorizadoEn });
  if (s.rechazadoPor && s.rechazadoEn) pasos.push({ etiqueta: "Rechazó", quien: s.rechazadoPor.correo, cuando: s.rechazadoEn, detalle: s.motivoRechazo });
  if (s.entregadoPor && s.entregadoEn) {
    pasos.push({ etiqueta: "Registró el retiro", quien: s.entregadoPor.correo, cuando: s.entregadoEn, detalle: s.entregadoA && `Se lo llevó ${s.entregadoA}` });
  }
  if (s.recibidoPor && s.recibidoEn) pasos.push({ etiqueta: "Confirmó la recepción", quien: s.recibidoPor.correo, cuando: s.recibidoEn });
  if (s.canceladoPorUsuario && s.canceladoEn) {
    pasos.push({ etiqueta: "Canceló", quien: s.canceladoPorUsuario.correo, cuando: s.canceladoEn, detalle: s.motivoCancelacion });
  }

  return (
    <ol className="divide-y divide-border">
      {pasos.map((p) => (
        <li key={p.etiqueta} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 py-3 text-sm">
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

export function AvisosDeRetiro({ avisos }: { avisos: string[] }) {
  return (
    <div className="px-5 py-4 text-sm">
      <ul className="list-disc space-y-1 pl-5 text-warning">
        {avisos.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ul>
      <p className="mt-2 text-muted">
        Si no se corrige, cancela la salida y vuelve a solicitarla. Un cambio de piezas por caja no se corrige: la solicitud autorizada no se reinterpreta.
      </p>
    </div>
  );
}

/**
 * `existencias` llega solo a quien puede retirar la salida (artículo → lo que
 * hay en la bodega de origen); a los demás no se les consulta.
 */
export function PartidasSalida({ salida: s, existencias }: { salida: SalidaDetalle; existencias: Record<string, number> | null }) {
  const retirada = s.estatus === "RETIRADA" || s.estatus === "RECIBIDA";
  return (
    <Tabla>
      <thead>
        <tr>
          <Th>Artículo</Th>
          <Th className="text-right">Pedido</Th>
          <Th className="text-right">Unidades base</Th>
          {existencias && <Th className="text-right">En bodega</Th>}
          <Th>Observaciones</Th>
        </tr>
      </thead>
      <tbody>
        {s.partidas.map((p) => {
          const unidad = p.articulo.unidad.clave;
          const hay = existencias ? (existencias[p.articuloId] ?? 0) : null;
          return (
            <PartidaConConsumos key={p.id} consumos={retirada ? p.consumos : []} unidad={unidad} columnas={existencias ? 5 : 4}>
              <Td className="whitespace-nowrap">
                <span className="font-medium">{p.articulo.clave}</span> <span className="text-muted">{p.articulo.descripcion}</span>
                <DeBaja activa={p.articulo.activo} texto="Dado de baja" />
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
              <Td className="text-muted">{p.observaciones ?? "—"}</Td>
            </PartidaConConsumos>
          );
        })}
      </tbody>
    </Tabla>
  );
}

/** La partida y, si ya salió, de qué capa salió cada pieza y a qué costo, en orden PEPS. */
function PartidaConConsumos({
  consumos,
  unidad,
  columnas,
  children,
}: {
  consumos: SalidaDetalle["partidas"][number]["consumos"];
  unidad: string;
  columnas: number;
  children: React.ReactNode;
}) {
  return (
    <>
      <Tr>{children}</Tr>
      {consumos.length > 0 && (
        <tr>
          <td colSpan={columnas} className="border-b border-border bg-surface-muted/40 px-4 py-2">
            <ul className="space-y-0.5 text-xs text-muted-strong">
              {consumos.map((c, i) => (
                <li key={i} className="tabular">
                  {cantidad(c.cantidad)} {unidad} de la capa del {formatearFecha(c.capa.fechaOriginal)}
                  {c.capa.movimiento.folio ? ` (${c.capa.movimiento.folio})` : ""} · {costo(c.costoUnitario)}
                  {c.costoUnitarioConIva !== null && ` · ${costo(c.costoUnitarioConIva)} con IVA`}
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}

export function ValuacionSalida({ valuacion: v }: { valuacion: Valuacion }) {
  return (
    <dl className="grid gap-x-8 gap-y-2 border-t border-border px-5 py-4 text-sm sm:grid-cols-3">
      <div className="flex justify-between sm:block"><dt className="text-muted">Importe</dt><dd className="tabular font-medium">{v.importe === null ? "—" : moneda(v.importe)}</dd></div>
      <div className="flex justify-between sm:block"><dt className="text-muted">Con IVA</dt><dd className="tabular font-semibold">{v.importeConIva === null ? "—" : moneda(v.importeConIva)}</dd></div>
      {v.piezasSinCosto > 0 && (
        <div className="flex justify-between sm:block">
          <dt className="text-muted">Sin costo conocido</dt>
          <dd className="tabular font-medium">{cantidad(v.piezasSinCosto)} piezas, fuera del importe</dd>
        </div>
      )}
    </dl>
  );
}
