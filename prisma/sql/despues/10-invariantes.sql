-- ═══════════════════════════════════════════════════════════════════════════
-- Los invariantes, escritos en la base y no solo en español.
--
-- docs/02-modelo-de-datos.md §4 declara once invariantes. Escritos en prosa,
-- todos dependían de que la capa de servicios fuera el único escritor — y no
-- lo va a ser: la migración de datos escribe directo, prisma studio escribe
-- directo, y el psql de una noche de urgencias también.
--
-- Aquí dejan de depender de eso.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────── Movimiento ─────────────────────────────────

-- Dos máquinas de estados en un solo enum. Esta es la frontera entre ellas:
-- nada de tipo = ENTRADA, estatus = AUTORIZADA.
ALTER TABLE "Movimiento" ADD CONSTRAINT "movimiento_tipo_estatus_ck" CHECK (
  (tipo = 'SALIDA'  AND estatus IN ('SOLICITADA','AUTORIZADA','RECHAZADA','ENTREGADA','RECIBIDA','CANCELADO'))
  OR
  (tipo <> 'SALIDA' AND estatus IN ('BORRADOR','CONFIRMADO','CANCELADO'))
);

-- Qué contraparte exige cada tipo (docs/02 §2).
ALTER TABLE "Movimiento" ADD CONSTRAINT "movimiento_entrada_ck" CHECK (
  tipo <> 'ENTRADA' OR (
    "bodegaDestinoId" IS NOT NULL AND "proveedorId" IS NOT NULL AND "bodegaOrigenId" IS NULL
  )
);

ALTER TABLE "Movimiento" ADD CONSTRAINT "movimiento_salida_ck" CHECK (
  tipo <> 'SALIDA' OR (
    "bodegaOrigenId" IS NOT NULL AND "estacionId" IS NOT NULL AND "bodegaDestinoId" IS NULL
  )
);

-- Invariante 5: origen y destino de un traspaso son bodegas distintas.
ALTER TABLE "Movimiento" ADD CONSTRAINT "movimiento_traspaso_ck" CHECK (
  tipo <> 'TRASPASO' OR (
    "bodegaOrigenId" IS NOT NULL AND "bodegaDestinoId" IS NOT NULL
    AND "bodegaOrigenId" <> "bodegaDestinoId"
  )
);

ALTER TABLE "Movimiento" ADD CONSTRAINT "movimiento_devolucion_ck" CHECK (
  tipo <> 'DEVOLUCION' OR (
    "bodegaDestinoId" IS NOT NULL AND "estacionId" IS NOT NULL AND "bodegaOrigenId" IS NULL
  )
);

-- El signo del ajuste vive en la bodega, no en la cantidad: con destino suma,
-- con origen resta. Así la cantidad es siempre positiva y el CHECK de la
-- partida no tiene excepciones.
ALTER TABLE "Movimiento" ADD CONSTRAINT "movimiento_ajuste_ck" CHECK (
  tipo <> 'AJUSTE' OR (
    ("bodegaOrigenId" IS NULL) <> ("bodegaDestinoId" IS NULL) AND motivo IS NOT NULL
  )
);

-- Contrapartes que no pertenecen a otros tipos.
ALTER TABLE "Movimiento" ADD CONSTRAINT "movimiento_proveedor_solo_entrada_ck" CHECK (
  "proveedorId" IS NULL OR tipo = 'ENTRADA'
);

ALTER TABLE "Movimiento" ADD CONSTRAINT "movimiento_estacion_ck" CHECK (
  "estacionId" IS NULL OR tipo IN ('SALIDA','DEVOLUCION')
);

-- El área es opcional incluso en salida: el histórico del Excel no la trae.
ALTER TABLE "Movimiento" ADD CONSTRAINT "movimiento_area_solo_salida_ck" CHECK (
  "areaId" IS NULL OR tipo = 'SALIDA'
);

ALTER TABLE "Movimiento" ADD CONSTRAINT "movimiento_prestamo_solo_salida_ck" CHECK (
  NOT "esPrestamo" OR tipo = 'SALIDA'
);

ALTER TABLE "Movimiento" ADD CONSTRAINT "movimiento_devuelve_solo_devolucion_ck" CHECK (
  "devuelveAId" IS NULL OR tipo = 'DEVOLUCION'
);

-- ── Dinero: solo en ENTRADA, y el tipo de cambio solo en dólares ──────────

ALTER TABLE "Movimiento" ADD CONSTRAINT "movimiento_dinero_solo_entrada_ck" CHECK (
  tipo = 'ENTRADA' OR (
    moneda IS NULL AND "tipoCambio" IS NULL
    AND subtotal IS NULL AND iva IS NULL AND total IS NULL
  )
);

ALTER TABLE "Movimiento" ADD CONSTRAINT "movimiento_entrada_moneda_ck" CHECK (
  tipo <> 'ENTRADA' OR moneda IS NOT NULL
);

-- En dólares el tipo de cambio no es opcional: sin él la capa no se puede
-- valuar en pesos, y docs/02 §5 promete que la capa siempre guarda pesos.
ALTER TABLE "Movimiento" ADD CONSTRAINT "movimiento_usd_exige_cambio_ck" CHECK (
  moneda <> 'USD' OR "tipoCambio" IS NOT NULL
);

-- En pesos, un tipo de cambio no significa nada.
ALTER TABLE "Movimiento" ADD CONSTRAINT "movimiento_mxn_sin_cambio_ck" CHECK (
  moneda <> 'MXN' OR "tipoCambio" IS NULL
);

ALTER TABLE "Movimiento" ADD CONSTRAINT "movimiento_cambio_positivo_ck" CHECK (
  "tipoCambio" IS NULL OR "tipoCambio" > 0
);

ALTER TABLE "Movimiento" ADD CONSTRAINT "movimiento_importes_no_negativos_ck" CHECK (
  (subtotal IS NULL OR subtotal >= 0)
  AND (iva IS NULL OR iva >= 0)
  AND (total IS NULL OR total >= 0)
);

-- ── Actor y marca de tiempo: nunca uno sin el otro ────────────────────────

ALTER TABLE "Movimiento" ADD CONSTRAINT "movimiento_confirmado_par_ck"  CHECK (("confirmadoPorId" IS NULL) = ("confirmadoEn" IS NULL));
ALTER TABLE "Movimiento" ADD CONSTRAINT "movimiento_autorizado_par_ck"  CHECK (("autorizadoPorId" IS NULL) = ("autorizadoEn" IS NULL));
ALTER TABLE "Movimiento" ADD CONSTRAINT "movimiento_rechazado_par_ck"   CHECK (("rechazadoPorId"  IS NULL) = ("rechazadoEn"  IS NULL));
ALTER TABLE "Movimiento" ADD CONSTRAINT "movimiento_entregado_par_ck"   CHECK (("entregadoPorId"  IS NULL) = ("entregadoEn"  IS NULL));
ALTER TABLE "Movimiento" ADD CONSTRAINT "movimiento_recibido_par_ck"    CHECK (("recibidoPorId"   IS NULL) = ("recibidoEn"   IS NULL));
ALTER TABLE "Movimiento" ADD CONSTRAINT "movimiento_cancelado_par_ck"   CHECK (("canceladoPorId"  IS NULL) = ("canceladoEn"  IS NULL));

-- Invariante 8: el folio se asigna al confirmar, no al crear el borrador.
ALTER TABLE "Movimiento" ADD CONSTRAINT "movimiento_folio_no_en_borrador_ck" CHECK (
  folio IS NULL OR estatus <> 'BORRADOR'
);

-- Cada dato pertenece a un estado o a un tipo, y fuera de ellos no existe:
-- un borrador que ya trae motivo de cancelación se confirmaría cargándolo, y
-- una entrada con autorizador diría algo que nunca pasó.

ALTER TABLE "Movimiento" ADD CONSTRAINT "movimiento_cancelacion_solo_cancelado_ck" CHECK (
  (estatus =  'CANCELADO' AND "canceladoPorId" IS NOT NULL AND "motivoCancelacion" IS NOT NULL)
  OR
  (estatus <> 'CANCELADO' AND "canceladoPorId" IS NULL     AND "motivoCancelacion" IS NULL)
);

ALTER TABLE "Movimiento" ADD CONSTRAINT "movimiento_entrada_sin_datos_ajenos_ck" CHECK (
  tipo <> 'ENTRADA' OR (
    "autorizadoPorId" IS NULL AND "rechazadoPorId" IS NULL AND "motivoRechazo" IS NULL
    AND "entregadoPorId" IS NULL AND "recibidoPorId" IS NULL
    AND "solicitadoPorId" IS NULL AND "entregadoA" IS NULL AND motivo IS NULL
  )
);

-- Un borrador no tiene quién lo confirmó; un confirmado lo tiene siempre, con
-- folio e instante (11 §4). Con el par actor/instante de arriba, exigir el
-- actor exige los dos.
ALTER TABLE "Movimiento" ADD CONSTRAINT "movimiento_borrador_sin_confirmador_ck" CHECK (
  estatus <> 'BORRADOR' OR "confirmadoPorId" IS NULL
);

ALTER TABLE "Movimiento" ADD CONSTRAINT "movimiento_confirmado_completo_ck" CHECK (
  estatus <> 'CONFIRMADO' OR (folio IS NOT NULL AND "confirmadoPorId" IS NOT NULL)
);

-- Una entrada confirmada trae sus importes: nacen completas (11 §1).
ALTER TABLE "Movimiento" ADD CONSTRAINT "movimiento_entrada_confirmada_importes_ck" CHECK (
  tipo <> 'ENTRADA' OR estatus <> 'CONFIRMADO'
  OR (subtotal IS NOT NULL AND iva IS NOT NULL AND total IS NOT NULL)
);

-- Una entrada sin llave de idempotencia es una entrada que un doble clic puede
-- duplicar (11 §8). Los demás tipos la adoptan cuando se construyan.
ALTER TABLE "Movimiento" ADD CONSTRAINT "movimiento_entrada_llave_ck" CHECK (
  tipo <> 'ENTRADA' OR "llaveIdempotencia" IS NOT NULL
);

-- Antes del 2000 no hay operación que registrar. El otro extremo —no después
-- de hoy en México— lo pone la capa de servicios con lib/fechas.ts: aquí no
-- se usa CURRENT_DATE (01 §4.5).
ALTER TABLE "Movimiento" ADD CONSTRAINT "movimiento_fecha_minima_ck" CHECK (
  fecha >= DATE '2000-01-01'
);

-- Un movimiento rechazado dice por qué (el cancelado, arriba).
ALTER TABLE "Movimiento" ADD CONSTRAINT "movimiento_motivo_rechazo_ck" CHECK (
  estatus <> 'RECHAZADA' OR "motivoRechazo" IS NOT NULL
);

-- ─────────────────────────── MovimientoPartida ────────────────────────────

-- Invariante 3: cantidad positiva. Piezas enteras, sin excepciones — el signo
-- de un ajuste ya lo lleva la bodega.
ALTER TABLE "MovimientoPartida" ADD CONSTRAINT "partida_cantidad_positiva_ck" CHECK (cantidad > 0);

ALTER TABLE "MovimientoPartida" ADD CONSTRAINT "partida_orden_positivo_ck" CHECK (orden >= 1);

-- Nulo no es cero. «No sé cuánto costó» y «costó nada» son afirmaciones
-- distintas, y el reporte de valuación tiene que poder distinguirlas — pero
-- las dos columnas del par se desconocen juntas o se conocen juntas.
ALTER TABLE "MovimientoPartida" ADD CONSTRAINT "partida_par_costo_ck" CHECK (
  ("costoUnitario" IS NULL) = ("costoUnitarioConIva" IS NULL)
);

-- Invariante 11: con IVA nunca es menor que sin IVA. Iguales solo a tasa 0.
ALTER TABLE "MovimientoPartida" ADD CONSTRAINT "partida_iva_mayor_ck" CHECK (
  "costoUnitarioConIva" IS NULL OR "costoUnitarioConIva" >= "costoUnitario"
);

ALTER TABLE "MovimientoPartida" ADD CONSTRAINT "partida_costo_no_negativo_ck" CHECK (
  "costoUnitario" IS NULL OR "costoUnitario" >= 0
);

ALTER TABLE "MovimientoPartida" ADD CONSTRAINT "partida_tasa_iva_ck" CHECK (
  "tasaIva" IS NULL OR ("tasaIva" >= 0 AND "tasaIva" <= 1)
);

-- ── Normalización a la unidad base (11 §5) ────────────────────────────────
--
-- La cantidad canónica no se captura: se deriva. Escribir la regla aquí hace
-- que una partida con «3 CAJA de 12» y cantidad 30 sea imposible, la escriba
-- quien la escriba.

ALTER TABLE "MovimientoPartida" ADD CONSTRAINT "partida_captura_positiva_ck" CHECK (
  "cantidadCapturada" > 0 AND "factorConversion" > 0
);

ALTER TABLE "MovimientoPartida" ADD CONSTRAINT "partida_factor_unidad_ck" CHECK (
  "presentacionCapturada" <> 'UNIDAD' OR "factorConversion" = 1
);

ALTER TABLE "MovimientoPartida" ADD CONSTRAINT "partida_cantidad_normalizada_ck" CHECK (
  cantidad = "cantidadCapturada" * "factorConversion"
);

-- El costo capturado es el dato de origen del costo canónico: no puede haber
-- uno sin el otro. Al revés sí: una salida hereda costo de PEPS sin capturarlo.
ALTER TABLE "MovimientoPartida" ADD CONSTRAINT "partida_costo_capturado_ck" CHECK (
  "costoUnitarioCapturado" IS NULL
  OR ("costoUnitarioCapturado" >= 0 AND "costoUnitario" IS NOT NULL)
);

-- ───────────────────────────── CapaCosto ──────────────────────────────────

ALTER TABLE "CapaCosto" ADD CONSTRAINT "capa_inicial_positiva_ck" CHECK ("cantidadInicial" > 0);

-- Invariante 9, la mitad que se puede escribir en la fila. La otra mitad
-- —SUM(cantidadRestante) = Existencia.cantidad— es una prueba de integración,
-- y con cantidades enteras se verifica por igualdad exacta.
ALTER TABLE "CapaCosto" ADD CONSTRAINT "capa_restante_ck" CHECK (
  "cantidadRestante" >= 0 AND "cantidadRestante" <= "cantidadInicial"
);

ALTER TABLE "CapaCosto" ADD CONSTRAINT "capa_par_costo_ck" CHECK (
  ("costoUnitario" IS NULL) = ("costoUnitarioConIva" IS NULL)
);

ALTER TABLE "CapaCosto" ADD CONSTRAINT "capa_iva_mayor_ck" CHECK (
  "costoUnitarioConIva" IS NULL OR "costoUnitarioConIva" >= "costoUnitario"
);

ALTER TABLE "CapaCosto" ADD CONSTRAINT "capa_costo_no_negativo_ck" CHECK (
  "costoUnitario" IS NULL OR "costoUnitario" >= 0
);

-- La entrada original no puede ser posterior a la aparición de la capa en la
-- bodega. Un traspaso trae material viejo: fechaOriginal queda atrás, nunca
-- adelante.
ALTER TABLE "CapaCosto" ADD CONSTRAINT "capa_fecha_original_ck" CHECK (
  "fechaOriginal" <= fecha
);

-- Una capa no se parte de sí misma.
ALTER TABLE "CapaCosto" ADD CONSTRAINT "capa_origen_distinto_ck" CHECK (
  "origenId" IS NULL OR "origenId" <> id
);

-- ──────────────────────────── ConsumoCapa ─────────────────────────────────

ALTER TABLE "ConsumoCapa" ADD CONSTRAINT "consumo_cantidad_positiva_ck" CHECK (cantidad > 0);

ALTER TABLE "ConsumoCapa" ADD CONSTRAINT "consumo_par_costo_ck" CHECK (
  ("costoUnitario" IS NULL) = ("costoUnitarioConIva" IS NULL)
);

ALTER TABLE "ConsumoCapa" ADD CONSTRAINT "consumo_iva_mayor_ck" CHECK (
  "costoUnitarioConIva" IS NULL OR "costoUnitarioConIva" >= "costoUnitario"
);

-- ───────────────────────── Existencia y catálogos ─────────────────────────

-- Invariante 6, el que Diana y Oscar confirmaron por separado.
ALTER TABLE "Existencia" ADD CONSTRAINT "existencia_no_negativa_ck" CHECK (cantidad >= 0);

ALTER TABLE "Articulo" ADD CONSTRAINT "articulo_stock_minimo_ck" CHECK ("stockMinimo" >= 0);

ALTER TABLE "Articulo" ADD CONSTRAINT "articulo_piezas_por_caja_ck" CHECK (
  "piezasPorCaja" IS NULL OR "piezasPorCaja" > 0
);

ALTER TABLE "Folio" ADD CONSTRAINT "folio_siguiente_positivo_ck" CHECK (siguiente > 0);

-- ───────────────────────────────── Acceso ──────────────────────────────────

-- Un solo usuario ACTIVO por correo, sin límite en los históricos.
--
-- `Usuario.correo` no es único a propósito: la identidad canónica es
-- `clerkUserId`. Cuando alguien se da de baja en Clerk su fila se conserva
-- —de ella cuelgan la bitácora y siete relaciones de Movimiento—, y ese mismo
-- correo puede volver a darse de alta después con otro `clerkUserId`.
--
-- Lo que no puede pasar es que dos cuentas ACTIVAS compartan correo: sería
-- convertir el historial de una persona en el de otra.
--
-- Va en `lower()` porque un correo no distingue mayúsculas. Clerk ya los
-- normaliza; esto cubre lo que se escriba a mano.
--
-- Prisma no sabe expresar un índice parcial, por eso vive aquí y no en
-- schema.prisma.
CREATE UNIQUE INDEX "usuario_correo_activo_uq"
  ON public."Usuario" (lower(correo)) WHERE activo;

-- ───────────────────── Nombres únicos en los catálogos ─────────────────────
--
-- Bodega.nombre, Persona.nombre y Proveedor.nombreComercial son la forma en
-- que una persona identifica el registro, y también la clave con la que los
-- scripts de configuración y de migración deciden si un renglón ya existe.
-- Sin unicidad, «Diana Damián» y «diana damián» serían dos personas, y un
-- script que busca por nombre actualizaría una fila cualquiera.
--
-- «Único» aquí significa sin distinguir mayúsculas ni espacios sobrantes.
-- La función es IMMUTABLE porque un índice lo exige, y los scripts la usan
-- también para BUSCAR: es la única manera de que la búsqueda y el índice
-- coincidan siempre.

CREATE OR REPLACE FUNCTION nombre_normalizado(texto text) RETURNS text AS $$
  SELECT lower(regexp_replace(btrim(texto), '\s+', ' ', 'g'));
$$ LANGUAGE sql IMMUTABLE STRICT;

COMMENT ON FUNCTION nombre_normalizado(text) IS
  'Minúsculas y un solo espacio entre palabras. Base de los índices únicos por nombre.';

CREATE UNIQUE INDEX "bodega_nombre_uq"
  ON public."Bodega" (nombre_normalizado(nombre));
CREATE UNIQUE INDEX "persona_nombre_uq"
  ON public."Persona" (nombre_normalizado(nombre));
CREATE UNIQUE INDEX "proveedor_nombre_comercial_uq"
  ON public."Proveedor" (nombre_normalizado("nombreComercial"));
