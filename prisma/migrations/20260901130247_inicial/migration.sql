-- BodeGasosur — migración «inicial»
-- Armada por scripts/armar-migracion.sh. No editar a mano:
-- el SQL a mano vive en prisma/sql/ y se vuelve a armar desde ahí.

-- ═══ prisma/sql/antes ═══

-- ═══════════════════════════════════════════════════════════════════════════
-- Lo que tiene que existir ANTES de que Prisma cree las tablas.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── UUIDv7 del lado del servidor ───────────────────────────────────────────
--
-- Prisma genera los UUIDv7 en el cliente, así que las filas que escribe la
-- aplicación no necesitan nada. Pero la Bitacora la escribe un trigger, y ahí
-- no hay cliente: hace falta generarlos en SQL.
--
-- PostgreSQL 18 trae uuidv7() nativo; este contenedor corre la 16. La función
-- se llama uuid_generate_v7 y no uuidv7 justo para no chocar con la nativa el
-- día que se actualice el servidor — ese día, esta se borra y los DEFAULT
-- cambian de nombre, sin migrar un solo dato.

CREATE OR REPLACE FUNCTION uuid_generate_v7() RETURNS uuid AS $$
  SELECT encode(
    set_bit(
      set_bit(
        overlay(
          uuid_send(gen_random_uuid())
          PLACING substring(
            int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint)
            FROM 3
          )
          FROM 1 FOR 6
        ),
        52, 1
      ),
      53, 1
    ),
    'hex'
  )::uuid;
$$ LANGUAGE sql VOLATILE;

COMMENT ON FUNCTION uuid_generate_v7() IS
  'UUIDv7 para las filas que escribe la base y no la aplicación. Sustituible por uuidv7() nativo en PostgreSQL 18.';

-- ── Consecutivo de la clave de artículo ────────────────────────────────────
--
-- La clave la asigna el sistema: ART-00001, ART-00002… Sin prefijo de
-- categoría, porque una clave que codifica la categoría miente en cuanto
-- Compras recategoriza el artículo — que es el error que el catálogo viejo
-- ya cometió.
--
-- Una secuencia deja huecos si una inserción falla, y en artículos da igual.
-- El folio NO puede usar una por exactamente esa razón: el invariante 8 exige
-- consecutivo sin huecos, y por eso se toma con UPDATE … RETURNING.

CREATE SEQUENCE IF NOT EXISTS articulo_clave_seq AS bigint START WITH 1;

-- ═══ generado desde schema.prisma ═══

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "catalogo_gasosur";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TipoMovimiento" AS ENUM ('ENTRADA', 'SALIDA', 'TRASPASO', 'DEVOLUCION', 'AJUSTE');

-- CreateEnum
CREATE TYPE "EstatusMovimiento" AS ENUM ('BORRADOR', 'CONFIRMADO', 'SOLICITADA', 'AUTORIZADA', 'RECHAZADA', 'ENTREGADA', 'RECIBIDA', 'CANCELADO');

-- CreateEnum
CREATE TYPE "Moneda" AS ENUM ('MXN', 'USD');

-- CreateEnum
CREATE TYPE "Rol" AS ENUM ('SUPERADMIN', 'COMPRAS', 'JEFE');

-- CreateEnum
CREATE TYPE "AccionBitacora" AS ENUM ('INSERTAR', 'ACTUALIZAR', 'ELIMINAR');

-- CreateEnum
CREATE TYPE "TipoEventoAcceso" AS ENUM ('SESION_INICIADA', 'SESION_TERMINADA', 'SESION_REMOVIDA', 'SESION_REVOCADA', 'ACCESO_DENEGADO');

-- CreateTable
CREATE TABLE "catalogo_gasosur"."Empresa" (
    "id" UUID NOT NULL,
    "razonSocial" TEXT NOT NULL,
    "rfc" TEXT,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Empresa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalogo_gasosur"."Estacion" (
    "id" UUID NOT NULL,
    "numero" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "empresaId" UUID NOT NULL,
    "telefono" TEXT,
    "movil" TEXT,
    "correo" TEXT,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Estacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Usuario" (
    "id" UUID NOT NULL,
    "clerkUserId" TEXT NOT NULL,
    "correo" TEXT NOT NULL,
    "rol" "Rol" NOT NULL,
    "puedeAutorizar" BOOLEAN NOT NULL DEFAULT false,
    "personaId" UUID,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventoAcceso" (
    "id" UUID NOT NULL,
    "usuarioId" UUID,
    "clerkUserId" TEXT NOT NULL,
    "tipo" "TipoEventoAcceso" NOT NULL,
    "ocurridoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "agente" TEXT,

    CONSTRAINT "EventoAcceso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventoWebhook" (
    "eventoId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "recibidoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "procesadoEn" TIMESTAMPTZ(3),

    CONSTRAINT "EventoWebhook_pkey" PRIMARY KEY ("eventoId")
);

-- CreateTable
CREATE TABLE "Bitacora" (
    "id" UUID NOT NULL,
    "tabla" TEXT NOT NULL,
    "registroId" TEXT NOT NULL,
    "accion" "AccionBitacora" NOT NULL,
    "usuarioId" UUID,
    "origen" TEXT,
    "antes" JSONB,
    "despues" JSONB,
    "ocurridoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bitacora_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bodega" (
    "id" UUID NOT NULL,
    "clave" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "ubicacion" TEXT,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Bodega_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Area" (
    "id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Area_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnidadMedida" (
    "id" UUID NOT NULL,
    "clave" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "UnidadMedida_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoriaArticulo" (
    "id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CategoriaArticulo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Articulo" (
    "id" UUID NOT NULL,
    "clave" TEXT NOT NULL DEFAULT ('ART-' || lpad(nextval('articulo_clave_seq')::text, 5, '0')),
    "descripcion" TEXT NOT NULL,
    "unidadId" UUID NOT NULL,
    "categoriaId" UUID,
    "piezasPorCaja" INTEGER,
    "stockMinimo" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Articulo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proveedor" (
    "id" UUID NOT NULL,
    "empresaId" UUID NOT NULL,
    "nombreComercial" TEXT NOT NULL,
    "contacto" TEXT,
    "telefono" TEXT,
    "correo" TEXT,
    "giro" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Proveedor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Persona" (
    "id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "puesto" TEXT,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Persona_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Movimiento" (
    "id" UUID NOT NULL,
    "folio" TEXT,
    "tipo" "TipoMovimiento" NOT NULL,
    "estatus" "EstatusMovimiento" NOT NULL,
    "fecha" DATE NOT NULL,
    "bodegaOrigenId" UUID,
    "bodegaDestinoId" UUID,
    "proveedorId" UUID,
    "estacionId" UUID,
    "areaId" UUID,
    "referencia" TEXT,
    "motivo" TEXT,
    "moneda" "Moneda",
    "tipoCambio" DECIMAL(14,6),
    "subtotal" DECIMAL(14,2),
    "iva" DECIMAL(14,2),
    "total" DECIMAL(14,2),
    "solicitadoPorId" UUID,
    "entregadoA" TEXT,
    "esPrestamo" BOOLEAN NOT NULL DEFAULT false,
    "devuelveAId" UUID,
    "observaciones" TEXT,
    "motivoRechazo" TEXT,
    "motivoCancelacion" TEXT,
    "cancelaAId" UUID,
    "creadoPorId" UUID NOT NULL,
    "confirmadoPorId" UUID,
    "confirmadoEn" TIMESTAMPTZ(3),
    "autorizadoPorId" UUID,
    "autorizadoEn" TIMESTAMPTZ(3),
    "rechazadoPorId" UUID,
    "rechazadoEn" TIMESTAMPTZ(3),
    "entregadoPorId" UUID,
    "entregadoEn" TIMESTAMPTZ(3),
    "recibidoPorId" UUID,
    "recibidoEn" TIMESTAMPTZ(3),
    "canceladoPorId" UUID,
    "canceladoEn" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Movimiento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MovimientoPartida" (
    "id" UUID NOT NULL,
    "movimientoId" UUID NOT NULL,
    "articuloId" UUID NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "capturaOriginal" TEXT,
    "costoUnitario" DECIMAL(14,4),
    "costoUnitarioConIva" DECIMAL(14,4),
    "tasaIva" DECIMAL(5,4),
    "numeroSerie" TEXT,
    "observaciones" TEXT,

    CONSTRAINT "MovimientoPartida_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapaCosto" (
    "id" UUID NOT NULL,
    "bodegaId" UUID NOT NULL,
    "articuloId" UUID NOT NULL,
    "movimientoId" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "fechaOriginal" DATE NOT NULL,
    "origenId" UUID,
    "cantidadInicial" INTEGER NOT NULL,
    "cantidadRestante" INTEGER NOT NULL,
    "costoUnitario" DECIMAL(14,4),
    "costoUnitarioConIva" DECIMAL(14,4),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CapaCosto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsumoCapa" (
    "id" UUID NOT NULL,
    "partidaId" UUID NOT NULL,
    "capaId" UUID NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "costoUnitario" DECIMAL(14,4),
    "costoUnitarioConIva" DECIMAL(14,4),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsumoCapa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Existencia" (
    "bodegaId" UUID NOT NULL,
    "articuloId" UUID NOT NULL,
    "cantidad" INTEGER NOT NULL DEFAULT 0,
    "actualizadoEn" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Existencia_pkey" PRIMARY KEY ("bodegaId","articuloId")
);

-- CreateTable
CREATE TABLE "Folio" (
    "tipo" "TipoMovimiento" NOT NULL,
    "prefijo" TEXT NOT NULL,
    "siguiente" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Folio_pkey" PRIMARY KEY ("tipo")
);

-- CreateIndex
CREATE UNIQUE INDEX "Empresa_rfc_key" ON "catalogo_gasosur"."Empresa"("rfc");

-- CreateIndex
CREATE UNIQUE INDEX "Estacion_numero_key" ON "catalogo_gasosur"."Estacion"("numero");

-- CreateIndex
CREATE INDEX "Estacion_empresaId_idx" ON "catalogo_gasosur"."Estacion"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_clerkUserId_key" ON "Usuario"("clerkUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_personaId_key" ON "Usuario"("personaId");

-- CreateIndex
CREATE INDEX "EventoAcceso_usuarioId_ocurridoEn_idx" ON "EventoAcceso"("usuarioId", "ocurridoEn");

-- CreateIndex
CREATE INDEX "EventoAcceso_ocurridoEn_idx" ON "EventoAcceso"("ocurridoEn");

-- CreateIndex
CREATE INDEX "Bitacora_tabla_registroId_ocurridoEn_idx" ON "Bitacora"("tabla", "registroId", "ocurridoEn");

-- CreateIndex
CREATE INDEX "Bitacora_usuarioId_ocurridoEn_idx" ON "Bitacora"("usuarioId", "ocurridoEn");

-- CreateIndex
CREATE UNIQUE INDEX "Bodega_clave_key" ON "Bodega"("clave");

-- CreateIndex
CREATE UNIQUE INDEX "Area_nombre_key" ON "Area"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "UnidadMedida_clave_key" ON "UnidadMedida"("clave");

-- CreateIndex
CREATE UNIQUE INDEX "CategoriaArticulo_nombre_key" ON "CategoriaArticulo"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "Articulo_clave_key" ON "Articulo"("clave");

-- CreateIndex
CREATE INDEX "Articulo_descripcion_idx" ON "Articulo"("descripcion");

-- CreateIndex
CREATE INDEX "Articulo_categoriaId_idx" ON "Articulo"("categoriaId");

-- CreateIndex
CREATE INDEX "Articulo_unidadId_idx" ON "Articulo"("unidadId");

-- CreateIndex
CREATE INDEX "Proveedor_empresaId_idx" ON "Proveedor"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "Movimiento_folio_key" ON "Movimiento"("folio");

-- CreateIndex
CREATE UNIQUE INDEX "Movimiento_cancelaAId_key" ON "Movimiento"("cancelaAId");

-- CreateIndex
CREATE INDEX "Movimiento_tipo_estatus_fecha_idx" ON "Movimiento"("tipo", "estatus", "fecha");

-- CreateIndex
CREATE INDEX "Movimiento_estacionId_fecha_idx" ON "Movimiento"("estacionId", "fecha");

-- CreateIndex
CREATE INDEX "Movimiento_bodegaOrigenId_idx" ON "Movimiento"("bodegaOrigenId");

-- CreateIndex
CREATE INDEX "Movimiento_bodegaDestinoId_idx" ON "Movimiento"("bodegaDestinoId");

-- CreateIndex
CREATE INDEX "Movimiento_proveedorId_idx" ON "Movimiento"("proveedorId");

-- CreateIndex
CREATE INDEX "MovimientoPartida_articuloId_idx" ON "MovimientoPartida"("articuloId");

-- CreateIndex
CREATE UNIQUE INDEX "MovimientoPartida_movimientoId_articuloId_key" ON "MovimientoPartida"("movimientoId", "articuloId");

-- CreateIndex
CREATE INDEX "CapaCosto_bodegaId_articuloId_fechaOriginal_id_idx" ON "CapaCosto"("bodegaId", "articuloId", "fechaOriginal", "id");

-- CreateIndex
CREATE INDEX "CapaCosto_movimientoId_idx" ON "CapaCosto"("movimientoId");

-- CreateIndex
CREATE INDEX "CapaCosto_origenId_idx" ON "CapaCosto"("origenId");

-- CreateIndex
CREATE INDEX "ConsumoCapa_partidaId_idx" ON "ConsumoCapa"("partidaId");

-- CreateIndex
CREATE INDEX "ConsumoCapa_capaId_idx" ON "ConsumoCapa"("capaId");

-- CreateIndex
CREATE INDEX "Existencia_articuloId_idx" ON "Existencia"("articuloId");

-- AddForeignKey
ALTER TABLE "catalogo_gasosur"."Estacion" ADD CONSTRAINT "Estacion_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "catalogo_gasosur"."Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Usuario" ADD CONSTRAINT "Usuario_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoAcceso" ADD CONSTRAINT "EventoAcceso_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bitacora" ADD CONSTRAINT "Bitacora_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Articulo" ADD CONSTRAINT "Articulo_unidadId_fkey" FOREIGN KEY ("unidadId") REFERENCES "UnidadMedida"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Articulo" ADD CONSTRAINT "Articulo_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "CategoriaArticulo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proveedor" ADD CONSTRAINT "Proveedor_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "catalogo_gasosur"."Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Movimiento" ADD CONSTRAINT "Movimiento_bodegaOrigenId_fkey" FOREIGN KEY ("bodegaOrigenId") REFERENCES "Bodega"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Movimiento" ADD CONSTRAINT "Movimiento_bodegaDestinoId_fkey" FOREIGN KEY ("bodegaDestinoId") REFERENCES "Bodega"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Movimiento" ADD CONSTRAINT "Movimiento_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "Proveedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Movimiento" ADD CONSTRAINT "Movimiento_estacionId_fkey" FOREIGN KEY ("estacionId") REFERENCES "catalogo_gasosur"."Estacion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Movimiento" ADD CONSTRAINT "Movimiento_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Movimiento" ADD CONSTRAINT "Movimiento_solicitadoPorId_fkey" FOREIGN KEY ("solicitadoPorId") REFERENCES "Persona"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Movimiento" ADD CONSTRAINT "Movimiento_devuelveAId_fkey" FOREIGN KEY ("devuelveAId") REFERENCES "Movimiento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Movimiento" ADD CONSTRAINT "Movimiento_cancelaAId_fkey" FOREIGN KEY ("cancelaAId") REFERENCES "Movimiento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Movimiento" ADD CONSTRAINT "Movimiento_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Movimiento" ADD CONSTRAINT "Movimiento_confirmadoPorId_fkey" FOREIGN KEY ("confirmadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Movimiento" ADD CONSTRAINT "Movimiento_autorizadoPorId_fkey" FOREIGN KEY ("autorizadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Movimiento" ADD CONSTRAINT "Movimiento_rechazadoPorId_fkey" FOREIGN KEY ("rechazadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Movimiento" ADD CONSTRAINT "Movimiento_entregadoPorId_fkey" FOREIGN KEY ("entregadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Movimiento" ADD CONSTRAINT "Movimiento_recibidoPorId_fkey" FOREIGN KEY ("recibidoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Movimiento" ADD CONSTRAINT "Movimiento_canceladoPorId_fkey" FOREIGN KEY ("canceladoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoPartida" ADD CONSTRAINT "MovimientoPartida_movimientoId_fkey" FOREIGN KEY ("movimientoId") REFERENCES "Movimiento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoPartida" ADD CONSTRAINT "MovimientoPartida_articuloId_fkey" FOREIGN KEY ("articuloId") REFERENCES "Articulo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapaCosto" ADD CONSTRAINT "CapaCosto_bodegaId_fkey" FOREIGN KEY ("bodegaId") REFERENCES "Bodega"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapaCosto" ADD CONSTRAINT "CapaCosto_articuloId_fkey" FOREIGN KEY ("articuloId") REFERENCES "Articulo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapaCosto" ADD CONSTRAINT "CapaCosto_movimientoId_fkey" FOREIGN KEY ("movimientoId") REFERENCES "Movimiento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapaCosto" ADD CONSTRAINT "CapaCosto_origenId_fkey" FOREIGN KEY ("origenId") REFERENCES "CapaCosto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumoCapa" ADD CONSTRAINT "ConsumoCapa_partidaId_fkey" FOREIGN KEY ("partidaId") REFERENCES "MovimientoPartida"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumoCapa" ADD CONSTRAINT "ConsumoCapa_capaId_fkey" FOREIGN KEY ("capaId") REFERENCES "CapaCosto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Existencia" ADD CONSTRAINT "Existencia_bodegaId_fkey" FOREIGN KEY ("bodegaId") REFERENCES "Bodega"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Existencia" ADD CONSTRAINT "Existencia_articuloId_fkey" FOREIGN KEY ("articuloId") REFERENCES "Articulo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ═══ prisma/sql/despues ═══

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

-- Un movimiento cancelado o rechazado dice por qué.
ALTER TABLE "Movimiento" ADD CONSTRAINT "movimiento_motivo_cancelacion_ck" CHECK (
  estatus <> 'CANCELADO' OR "motivoCancelacion" IS NOT NULL
);

ALTER TABLE "Movimiento" ADD CONSTRAINT "movimiento_motivo_rechazo_ck" CHECK (
  estatus <> 'RECHAZADA' OR "motivoRechazo" IS NOT NULL
);

-- ─────────────────────────── MovimientoPartida ────────────────────────────

-- Invariante 3: cantidad positiva. Piezas enteras, sin excepciones — el signo
-- de un ajuste ya lo lleva la bodega.
ALTER TABLE "MovimientoPartida" ADD CONSTRAINT "partida_cantidad_positiva_ck" CHECK (cantidad > 0);

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
-- ═══════════════════════════════════════════════════════════════════════════
-- La bitácora, alimentada por trigger.
--
-- Se eligió trigger y no extensión de Prisma Client por una sola razón: la
-- extensión conoce al usuario pero no ve lo que escriben prisma studio, los
-- scripts de migración de la fase 4 ni una consulta directa. El trigger ve a
-- todos los escritores, y el usuario le llega por variable de sesión.
--
-- Contrato con la capa de servicios — accionProtegida lo cumple una vez para
-- todo el sistema, así que no hay que acordarse en cada servicio:
--
--     SET LOCAL app.usuario_id = '0199…';   -- peticiones con usuario
--     SET LOCAL app.origen     = 'clerk-webhook';  -- la segunda puerta
--
-- Cuando nadie fijó ninguna de las dos, la bitácora dice 'escritura-directa'.
-- Es una respuesta honesta, y hoy no existe ninguna.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "Bitacora" ALTER COLUMN id SET DEFAULT uuid_generate_v7();

CREATE OR REPLACE FUNCTION registrar_en_bitacora() RETURNS trigger AS $$
DECLARE
  v_usuario  uuid;
  v_origen   text;
  v_registro text;
  v_antes    jsonb;
  v_despues  jsonb;
  v_accion   "AccionBitacora";
BEGIN
  -- current_setting con missing_ok: si nadie la fijó, devuelve NULL en vez de
  -- reventar. Y si trae basura, se prefiere perder el actor a perder la
  -- escritura: el renglón queda como escritura directa.
  BEGIN
    v_usuario := nullif(current_setting('app.usuario_id', true), '')::uuid;
  EXCEPTION WHEN others THEN
    v_usuario := NULL;
  END;

  v_origen := nullif(current_setting('app.origen', true), '');

  IF TG_OP = 'DELETE' THEN
    v_accion  := 'ELIMINAR';
    v_antes   := to_jsonb(OLD);
    v_despues := NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    v_accion  := 'ACTUALIZAR';
    v_antes   := to_jsonb(OLD);
    v_despues := to_jsonb(NEW);
    -- Un UPDATE que no cambió nada no es historia. Se ignora updatedAt en la
    -- comparación: Prisma la toca en cada escritura, así que sin esto la
    -- guarda no se dispararía nunca y la bitácora se llenaría de renglones
    -- que no dicen nada.
    IF (v_antes - 'updatedAt') = (v_despues - 'updatedAt') THEN
      RETURN NEW;
    END IF;
  ELSE
    v_accion  := 'INSERTAR';
    v_antes   := NULL;
    v_despues := to_jsonb(NEW);
  END IF;

  v_registro := coalesce(v_despues, v_antes) ->> 'id';

  IF v_usuario IS NULL AND v_origen IS NULL THEN
    v_origen := 'escritura-directa';
  END IF;

  INSERT INTO "Bitacora" (tabla, "registroId", accion, "usuarioId", origen, antes, despues)
  VALUES (TG_TABLE_NAME, v_registro, v_accion, v_usuario, v_origen, v_antes, v_despues);

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── A qué tablas se engancha ───────────────────────────────────────────────
--
-- Fuera quedan, a propósito:
--   Existencia    — es una proyección recalculable; bitacorearla es duplicar
--                   el libro con ruido.
--   ConsumoCapa   — append-only por construcción: ya es su propia historia.
--   Folio         — cambia en cada confirmación y no dice nada que el folio
--                   del movimiento no diga.
--   Bitacora, EventoAcceso, EventoWebhook — registros, no datos.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'Movimiento', 'MovimientoPartida', 'CapaCosto',
    'Usuario',
    'Bodega', 'Area', 'UnidadMedida', 'CategoriaArticulo',
    'Articulo', 'Proveedor', 'Persona'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER bitacora_%s AFTER INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION registrar_en_bitacora()',
      lower(t), t
    );
  END LOOP;

  FOREACH t IN ARRAY ARRAY['Empresa', 'Estacion'] LOOP
    EXECUTE format(
      'CREATE TRIGGER bitacora_%s AFTER INSERT OR UPDATE OR DELETE ON catalogo_gasosur.%I
         FOR EACH ROW EXECUTE FUNCTION registrar_en_bitacora()',
      lower(t), t
    );
  END LOOP;
END $$;

-- ── EventoAcceso ───────────────────────────────────────────────────────────
-- Lo escriben los webhooks de sesión de Clerk, no un trigger, pero también
-- necesita generar su id del lado del servidor.

ALTER TABLE "EventoAcceso" ALTER COLUMN id SET DEFAULT uuid_generate_v7();
-- ═══════════════════════════════════════════════════════════════════════════
-- Lo que no se puede cambiar después de escrito.
--
-- Dos cosas distintas viven aquí:
--   1. Las claves de negocio, porque están en la URL y en los WhatsApp de
--      Compras. Inmutables sin excepción: la clave de artículo la asigna el
--      sistema, así que nadie la captura mal.
--   2. Quién autorizó y cuándo, porque es el rastro del requisito #1 del
--      sistema y un rastro que se puede reescribir no es un rastro.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────── Claves de negocio inmutables ─────────────────────

CREATE OR REPLACE FUNCTION impedir_cambio_de_clave() RETURNS trigger AS $$
DECLARE
  v_columna text := TG_ARGV[0];
  v_vieja   text := to_jsonb(OLD) ->> v_columna;
  v_nueva   text := to_jsonb(NEW) ->> v_columna;
BEGIN
  IF v_vieja IS DISTINCT FROM v_nueva THEN
    RAISE EXCEPTION
      'La clave de negocio %.% es inmutable: % no puede convertirse en %.',
      TG_TABLE_NAME, v_columna, v_vieja, v_nueva
      USING ERRCODE = 'check_violation',
            HINT = 'Si la clave quedó mal, se da de baja el registro y se crea otro.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER articulo_clave_inmutable
  BEFORE UPDATE ON public."Articulo"
  FOR EACH ROW EXECUTE FUNCTION impedir_cambio_de_clave('clave');

CREATE TRIGGER bodega_clave_inmutable
  BEFORE UPDATE ON public."Bodega"
  FOR EACH ROW EXECUTE FUNCTION impedir_cambio_de_clave('clave');

CREATE TRIGGER unidad_clave_inmutable
  BEFORE UPDATE ON public."UnidadMedida"
  FOR EACH ROW EXECUTE FUNCTION impedir_cambio_de_clave('clave');

CREATE TRIGGER estacion_numero_inmutable
  BEFORE UPDATE ON catalogo_gasosur."Estacion"
  FOR EACH ROW EXECUTE FUNCTION impedir_cambio_de_clave('numero');

-- ──────────────── Autorización: escritura única, y una sola vez ───────────

CREATE OR REPLACE FUNCTION impedir_reescribir_autorizacion() RETURNS trigger AS $$
BEGIN
  IF OLD."autorizadoPorId" IS NOT NULL
     AND NEW."autorizadoPorId" IS DISTINCT FROM OLD."autorizadoPorId" THEN
    RAISE EXCEPTION 'La autorización de un movimiento no se reescribe.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD."autorizadoEn" IS NOT NULL
     AND NEW."autorizadoEn" IS DISTINCT FROM OLD."autorizadoEn" THEN
    RAISE EXCEPTION 'La fecha de autorización de un movimiento no se reescribe.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER movimiento_autorizacion_escritura_unica
  BEFORE UPDATE ON public."Movimiento"
  FOR EACH ROW EXECUTE FUNCTION impedir_reescribir_autorizacion();

-- ─────────────── Quien autoriza tiene que poder autorizar ─────────────────
--
-- El requisito #1 del sistema es «no permitir salida sin autorización». El
-- permiso vive en Usuario.puedeAutorizar y la bandera es editable — esa fue
-- una decisión deliberada. Por eso la verificación tiene que ocurrir en el
-- instante del acto y quedar fechada: saber «¿lo tenía cuando autorizó?»
-- exige las dos cosas, y la Bitacora guarda el resto de la historia.

CREATE OR REPLACE FUNCTION verificar_facultad_de_autorizar() RETURNS trigger AS $$
DECLARE
  v_puede  boolean;
  v_activo boolean;
BEGIN
  IF NEW."autorizadoPorId" IS NULL THEN
    RETURN NEW;
  END IF;

  -- En un INSERT no hay OLD: en un UPDATE solo interesa el cambio.
  IF TG_OP = 'UPDATE' AND NEW."autorizadoPorId" IS NOT DISTINCT FROM OLD."autorizadoPorId" THEN
    RETURN NEW;
  END IF;

  SELECT "puedeAutorizar", activo INTO v_puede, v_activo
  FROM public."Usuario" WHERE id = NEW."autorizadoPorId";

  IF NOT coalesce(v_puede, false) OR NOT coalesce(v_activo, false) THEN
    RAISE EXCEPTION
      'El usuario % no tiene la facultad de autorizar salidas.', NEW."autorizadoPorId"
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER movimiento_verificar_autorizador
  BEFORE INSERT OR UPDATE ON public."Movimiento"
  FOR EACH ROW EXECUTE FUNCTION verificar_facultad_de_autorizar();
-- ═══════════════════════════════════════════════════════════════════════════
-- Dar de baja.
--
-- El principio, que hace innecesario decidir tabla por tabla:
--
--     La baja lógica no borra nada. Significa «ya no se puede elegir al
--     capturar». Todo lo histórico sigue existiendo, contando y apareciendo
--     en reportes.
--
-- Un artículo dado de baja con existencia sigue valuándose y sigue en el
-- kardex; simplemente no aparece en el selector de un movimiento nuevo.
--
-- Con una sola excepción, y es por criterio y no por invariante: desactivar
-- una bodega con material adentro no rompe nada, pero es casi siempre un
-- error de dedo, y su efecto es que inventario real desaparece de las
-- pantallas de captura sin que nadie lo note.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION impedir_baja_de_bodega_con_existencia() RETURNS trigger AS $$
DECLARE
  v_articulos int;
  v_piezas    bigint;
BEGIN
  IF OLD.activa AND NOT NEW.activa THEN
    SELECT count(*), coalesce(sum(cantidad), 0)
      INTO v_articulos, v_piezas
      FROM public."Existencia"
     WHERE "bodegaId" = NEW.id AND cantidad > 0;

    IF v_articulos > 0 THEN
      RAISE EXCEPTION
        'La bodega % todavía tiene % piezas de % artículos.', NEW.clave, v_piezas, v_articulos
        USING ERRCODE = 'check_violation',
              HINT = 'Traspasa o ajusta la existencia antes de dar de baja la bodega.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bodega_baja_con_existencia
  BEFORE UPDATE ON public."Bodega"
  FOR EACH ROW EXECUTE FUNCTION impedir_baja_de_bodega_con_existencia();
-- ═══════════════════════════════════════════════════════════════════════════
-- El catálogo del grupo, expuesto por vistas versionadas.
--
-- El propósito de catalogo_gasosur es que otros proyectos de Gasosur lo lean
-- directo. Si lo hicieran contra las tablas, dos cosas se romperían: podrían
-- escribirlas —y solo el Superadmin debe escribir Empresa y Estacion—, y
-- renombrar una columna física rompería software ajeno.
--
-- Con vistas versionadas se puede renombrar una columna sin romper a nadie, y
-- la escritura es imposible por construcción y no por acuerdo. De paso queda
-- resuelto el pendiente de docs/08 §10, versionar el contrato compartido.
--
-- Las vistas empiezan mínimas. Si un proyecto necesita el teléfono, nace
-- v_estacion_v2 y la v1 sigue viva. Eso es lo que se compra aquí.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE VIEW catalogo_gasosur.v_empresa_v1 AS
  SELECT id, "razonSocial", rfc, activa
    FROM catalogo_gasosur."Empresa";

CREATE VIEW catalogo_gasosur.v_estacion_v1 AS
  SELECT id, numero, alias, "empresaId", activa
    FROM catalogo_gasosur."Estacion";

COMMENT ON VIEW catalogo_gasosur.v_empresa_v1  IS 'Contrato v1 para otros proyectos del grupo. No cambiar columnas: crear v2.';
COMMENT ON VIEW catalogo_gasosur.v_estacion_v1 IS 'Contrato v1 para otros proyectos del grupo. No cambiar columnas: crear v2.';

-- ── El rol lector ──────────────────────────────────────────────────────────
--
-- NOLOGIN a propósito: es un rol de grupo. Cada proyecto entra con su propio
-- usuario y se le concede este rol, así que ninguna contraseña queda en el
-- repositorio y revocarle el acceso a un proyecto no toca a los demás:
--
--     CREATE ROLE proyecto_x LOGIN PASSWORD '…';   -- fuera de la migración
--     GRANT lector_catalogo TO proyecto_x;
--
-- Los roles son del clúster y no de la base, así que CREATE ROLE a secas
-- falla en la segunda corrida.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lector_catalogo') THEN
    CREATE ROLE lector_catalogo NOLOGIN;
  END IF;
END $$;

-- El orden importa, y no es evidente: en PostgreSQL «ALL TABLES» incluye las
-- vistas. Si las revocaciones fueran después de los GRANT, borrarían justo el
-- permiso que acaban de dar y los proyectos hermanos se quedarían fuera sin
-- que nada avisara. Primero se cierra todo, después se abre lo mínimo.

REVOKE ALL ON SCHEMA public            FROM lector_catalogo;
REVOKE ALL ON ALL TABLES    IN SCHEMA public           FROM lector_catalogo;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public           FROM lector_catalogo;
REVOKE ALL ON ALL TABLES    IN SCHEMA catalogo_gasosur FROM lector_catalogo;

-- Las tablas que se creen después tampoco quedan expuestas por omisión.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES FROM lector_catalogo;
ALTER DEFAULT PRIVILEGES IN SCHEMA catalogo_gasosur
  REVOKE ALL ON TABLES FROM lector_catalogo;

-- Y ahora lo único que sí puede ver: las dos vistas del contrato v1.
GRANT USAGE  ON SCHEMA catalogo_gasosur TO lector_catalogo;
GRANT SELECT ON catalogo_gasosur.v_empresa_v1, catalogo_gasosur.v_estacion_v1 TO lector_catalogo;
