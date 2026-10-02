import type { Prisma } from "@prisma/client";

// Primitivas de PostgreSQL de la fase 7. Todas exigen que el servicio ya haya
// tomado sus candados; la base vuelve a conciliar el resultado al confirmar
// (990-traspasos-devoluciones-conteo.sql).

type Tx = Prisma.TransactionClient;

/**
 * Una capa en destino por cada consumo del traspaso: misma cantidad, fecha
 * original y par de costos de la capa de origen, con origenId como rastro.
 */
export async function crearCapasDeTraspaso(tx: Tx, movimientoId: string, bodegaDestinoId: string, fecha: Date): Promise<number> {
  return tx.$executeRaw`
    INSERT INTO "CapaCosto"
      (id, "bodegaId", "articuloId", "movimientoId", fecha, "fechaOriginal", "origenId",
       "cantidadInicial", "cantidadRestante", "costoUnitario", "costoUnitarioConIva")
    SELECT uuid_generate_v7(), ${bodegaDestinoId}::uuid, p."articuloId", p."movimientoId", ${fecha}::date, origen."fechaOriginal", k."capaId",
           k.cantidad, k.cantidad, k."costoUnitario", k."costoUnitarioConIva"
    FROM "ConsumoCapa" k
    JOIN "MovimientoPartida" p ON p.id = k."partidaId"
    JOIN "CapaCosto" origen ON origen.id = k."capaId"
    WHERE p."movimientoId" = ${movimientoId}::uuid
    ORDER BY p."articuloId", origen."fechaOriginal", origen.id`;
}

/** Una capa sin costo por partida, con la fecha del movimiento: procedencia no comprobada o conteo. */
export async function crearCapasSinCosto(tx: Tx, movimientoId: string, bodegaDestinoId: string, fecha: Date): Promise<number> {
  return tx.$executeRaw`
    INSERT INTO "CapaCosto"
      (id, "bodegaId", "articuloId", "movimientoId", fecha, "fechaOriginal", "cantidadInicial", "cantidadRestante")
    SELECT uuid_generate_v7(), ${bodegaDestinoId}::uuid, p."articuloId", p."movimientoId", ${fecha}::date, ${fecha}::date, p.cantidad, p.cantidad
    FROM "MovimientoPartida" p
    WHERE p."movimientoId" = ${movimientoId}::uuid
    ORDER BY p."articuloId"`;
}

// ─────────────────────────────── Devoluciones ────────────────────────────────

export type SaldoDeArticulo = {
  articuloId: string;
  clave: string;
  descripcion: string;
  unidad: string;
  retirado: number;
  devuelto: number;
  pendiente: number;
};

/**
 * Lo retirado por artículo, lo que ya volvió en devoluciones vigentes
 * (confirmadas y sin reversa) y lo que falta. Se calcula desde los consumos
 * y las capas hijas: no hay un saldo guardado que pueda desviarse.
 */
export async function saldoDeSalida(tx: Tx, salidaId: string): Promise<SaldoDeArticulo[]> {
  return tx.$queryRaw<SaldoDeArticulo[]>`
    SELECT p."articuloId", a.clave, a.descripcion, u.clave AS unidad, p.cantidad AS retirado,
           coalesce(d.devuelto, 0)::int AS devuelto, (p.cantidad - coalesce(d.devuelto, 0))::int AS pendiente
    FROM "MovimientoPartida" p
    JOIN "Articulo" a ON a.id = p."articuloId"
    JOIN "UnidadMedida" u ON u.id = a."unidadId"
    LEFT JOIN LATERAL (
      SELECT sum(c."cantidadInicial") AS devuelto
      FROM "CapaCosto" c JOIN "Movimiento" dev ON dev.id = c."movimientoId"
      WHERE dev."devuelveAId" = p."movimientoId" AND c."articuloId" = p."articuloId" AND devolucion_vigente(dev.id)
    ) d ON true
    WHERE p."movimientoId" = ${salidaId}::uuid
    ORDER BY p.orden`;
}

/**
 * Reparte cada partida de la devolución entre los consumos de la salida que
 * aún tienen saldo, en orden determinista (fecha original y capa, como PEPS),
 * y crea una capa por consumo alcanzado con su costo y fecha original. Exige
 * haber comprobado el saldo con la salida bloqueada.
 */
export async function crearCapasDeDevolucion(
  tx: Tx,
  devolucionId: string,
  salidaId: string,
  bodegaDestinoId: string,
  fecha: Date,
): Promise<{ capas: number; piezas: number }> {
  const [r] = await tx.$queryRaw<{ capas: number; piezas: number }[]>`
    WITH partida AS (
      SELECT "articuloId", cantidad FROM "MovimientoPartida" WHERE "movimientoId" = ${devolucionId}::uuid
    ), consumo AS (
      SELECT k."capaId", p."articuloId", origen."fechaOriginal", k."costoUnitario", k."costoUnitarioConIva",
             k.cantidad - coalesce((
               SELECT sum(c."cantidadInicial") FROM "CapaCosto" c JOIN "Movimiento" dev ON dev.id = c."movimientoId"
               WHERE c."origenId" = k."capaId" AND dev."devuelveAId" = ${salidaId}::uuid AND devolucion_vigente(dev.id)
             ), 0) AS saldo
      FROM "ConsumoCapa" k
      JOIN "MovimientoPartida" p ON p.id = k."partidaId"
      JOIN "CapaCosto" origen ON origen.id = k."capaId"
      WHERE p."movimientoId" = ${salidaId}::uuid
    ), turno AS (
      SELECT *, sum(saldo) OVER (PARTITION BY "articuloId" ORDER BY "fechaOriginal", "capaId"
                                 ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) - saldo AS previo
      FROM consumo WHERE saldo > 0
    ), reparto AS (
      SELECT t."capaId", t."articuloId", t."fechaOriginal", t."costoUnitario", t."costoUnitarioConIva",
             least(t.saldo, p.cantidad - t.previo)::int AS cantidad
      FROM partida p JOIN turno t ON t."articuloId" = p."articuloId"
      WHERE t.previo < p.cantidad
    ), creadas AS (
      INSERT INTO "CapaCosto"
        (id, "bodegaId", "articuloId", "movimientoId", fecha, "fechaOriginal", "origenId",
         "cantidadInicial", "cantidadRestante", "costoUnitario", "costoUnitarioConIva")
      SELECT uuid_generate_v7(), ${bodegaDestinoId}::uuid, "articuloId", ${devolucionId}::uuid, ${fecha}::date, "fechaOriginal", "capaId",
             cantidad, cantidad, "costoUnitario", "costoUnitarioConIva"
      FROM reparto
      RETURNING "cantidadInicial"
    )
    SELECT count(*)::int AS capas, coalesce(sum("cantidadInicial"), 0)::int AS piezas FROM creadas`;
  return r;
}

// ──────────────────────────────── Reversas ───────────────────────────────────

/**
 * La reversa consume completas las capas que creó el original, cada una en
 * la partida de su artículo. Exige que sigan intactas: si una ya se usó, la
 * resta dejaría la capa en negativo y la base lo rechaza.
 */
export async function retirarCapasDelOriginal(tx: Tx, reversaId: string, originalId: string): Promise<{ capas: number; piezas: number }> {
  const [r] = await tx.$queryRaw<{ capas: number; piezas: number }[]>`
    WITH consumo AS (
      INSERT INTO "ConsumoCapa" (id, "partidaId", "capaId", cantidad, "costoUnitario", "costoUnitarioConIva")
      SELECT uuid_generate_v7(), p.id, c.id, c."cantidadInicial", c."costoUnitario", c."costoUnitarioConIva"
      FROM "CapaCosto" c
      JOIN "MovimientoPartida" p ON p."movimientoId" = ${reversaId}::uuid AND p."articuloId" = c."articuloId"
      WHERE c."movimientoId" = ${originalId}::uuid
      RETURNING "capaId", cantidad
    ), descuento AS (
      UPDATE "CapaCosto" c SET "cantidadRestante" = c."cantidadRestante" - consumo.cantidad
      FROM consumo WHERE c.id = consumo."capaId"
      RETURNING c.id
    )
    SELECT (SELECT count(*) FROM descuento)::int AS capas, (SELECT coalesce(sum(cantidad), 0) FROM consumo)::int AS piezas`;
  return r;
}

/** Devuelve cada consumo del original a su capa exacta y deja la restitución como rastro. */
export async function restituirConsumosDelOriginal(tx: Tx, reversaId: string, originalId: string): Promise<{ restituciones: number; piezas: number }> {
  const [r] = await tx.$queryRaw<{ restituciones: number; piezas: number }[]>`
    WITH restitucion AS (
      INSERT INTO "RestitucionCapa" (id, "partidaId", "consumoId", "capaId", cantidad, "costoUnitario", "costoUnitarioConIva")
      SELECT uuid_generate_v7(), pr.id, k.id, k."capaId", k.cantidad, k."costoUnitario", k."costoUnitarioConIva"
      FROM "ConsumoCapa" k
      JOIN "MovimientoPartida" po ON po.id = k."partidaId" AND po."movimientoId" = ${originalId}::uuid
      JOIN "MovimientoPartida" pr ON pr."movimientoId" = ${reversaId}::uuid AND pr."articuloId" = po."articuloId"
      RETURNING "capaId", cantidad
    ), por_capa AS (
      SELECT "capaId", sum(cantidad) AS cantidad FROM restitucion GROUP BY "capaId"
    ), repuesto AS (
      UPDATE "CapaCosto" c SET "cantidadRestante" = c."cantidadRestante" + por_capa.cantidad
      FROM por_capa WHERE c.id = por_capa."capaId"
      RETURNING c.id
    )
    SELECT (SELECT count(*) FROM restitucion)::int AS restituciones, (SELECT coalesce(sum(cantidad), 0) FROM restitucion)::int AS piezas`;
  return r;
}

/**
 * FOR UPDATE de las capas que la reversa toca —las que creó el original y
 * las que consumió— en orden estable, después de las existencias.
 */
export async function bloquearCapasDelOriginal(tx: Tx, originalId: string): Promise<void> {
  await tx.$queryRaw`
    SELECT c.id FROM "CapaCosto" c
    WHERE c."movimientoId" = ${originalId}::uuid
       OR c.id IN (SELECT k."capaId" FROM "ConsumoCapa" k JOIN "MovimientoPartida" p ON p.id = k."partidaId"
                   WHERE p."movimientoId" = ${originalId}::uuid)
    ORDER BY c."bodegaId", c."articuloId", c."fechaOriginal", c.id
    FOR UPDATE`;
}
