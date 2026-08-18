-- CreateEnum
CREATE TYPE "TipoMovimiento" AS ENUM ('ENTRADA', 'SALIDA', 'TRASPASO', 'AJUSTE');

-- CreateEnum
CREATE TYPE "EstatusMovimiento" AS ENUM ('BORRADOR', 'CONFIRMADO', 'CANCELADO');

-- CreateTable
CREATE TABLE "Bodega" (
    "id" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "ubicacion" TEXT,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bodega_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Estacion" (
    "id" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "ubicacion" TEXT,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Estacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Area" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Area_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnidadMedida" (
    "id" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "UnidadMedida_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoriaArticulo" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CategoriaArticulo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Articulo" (
    "id" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "unidadId" TEXT NOT NULL,
    "categoriaId" TEXT,
    "stockMinimo" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Articulo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proveedor" (
    "id" TEXT NOT NULL,
    "razonSocial" TEXT NOT NULL,
    "rfc" TEXT,
    "contacto" TEXT,
    "telefono" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Proveedor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Persona" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "puesto" TEXT,
    "esTransportista" BOOLEAN NOT NULL DEFAULT false,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Persona_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Movimiento" (
    "id" TEXT NOT NULL,
    "folio" TEXT,
    "tipo" "TipoMovimiento" NOT NULL,
    "estatus" "EstatusMovimiento" NOT NULL DEFAULT 'BORRADOR',
    "fecha" TIMESTAMP(3) NOT NULL,
    "bodegaOrigenId" TEXT,
    "bodegaDestinoId" TEXT,
    "proveedorId" TEXT,
    "estacionId" TEXT,
    "areaId" TEXT,
    "referencia" TEXT,
    "motivo" TEXT,
    "solicitadoPorId" TEXT,
    "autorizadoPorId" TEXT,
    "transportistaId" TEXT,
    "recibidoPorId" TEXT,
    "vehiculo" TEXT,
    "observaciones" TEXT,
    "motivoCancelacion" TEXT,
    "cancelaAId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Movimiento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MovimientoPartida" (
    "id" TEXT NOT NULL,
    "movimientoId" TEXT NOT NULL,
    "articuloId" TEXT NOT NULL,
    "cantidad" DECIMAL(14,3) NOT NULL,
    "costoUnitario" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "observaciones" TEXT,

    CONSTRAINT "MovimientoPartida_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Existencia" (
    "bodegaId" TEXT NOT NULL,
    "articuloId" TEXT NOT NULL,
    "cantidad" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "costoPromedio" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

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
CREATE UNIQUE INDEX "Bodega_clave_key" ON "Bodega"("clave");

-- CreateIndex
CREATE UNIQUE INDEX "Estacion_clave_key" ON "Estacion"("clave");

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
CREATE UNIQUE INDEX "Proveedor_rfc_key" ON "Proveedor"("rfc");

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
CREATE INDEX "MovimientoPartida_articuloId_idx" ON "MovimientoPartida"("articuloId");

-- CreateIndex
CREATE UNIQUE INDEX "MovimientoPartida_movimientoId_articuloId_key" ON "MovimientoPartida"("movimientoId", "articuloId");

-- CreateIndex
CREATE INDEX "Existencia_articuloId_idx" ON "Existencia"("articuloId");

-- AddForeignKey
ALTER TABLE "Articulo" ADD CONSTRAINT "Articulo_unidadId_fkey" FOREIGN KEY ("unidadId") REFERENCES "UnidadMedida"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Articulo" ADD CONSTRAINT "Articulo_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "CategoriaArticulo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Movimiento" ADD CONSTRAINT "Movimiento_bodegaOrigenId_fkey" FOREIGN KEY ("bodegaOrigenId") REFERENCES "Bodega"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Movimiento" ADD CONSTRAINT "Movimiento_bodegaDestinoId_fkey" FOREIGN KEY ("bodegaDestinoId") REFERENCES "Bodega"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Movimiento" ADD CONSTRAINT "Movimiento_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "Proveedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Movimiento" ADD CONSTRAINT "Movimiento_estacionId_fkey" FOREIGN KEY ("estacionId") REFERENCES "Estacion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Movimiento" ADD CONSTRAINT "Movimiento_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Movimiento" ADD CONSTRAINT "Movimiento_solicitadoPorId_fkey" FOREIGN KEY ("solicitadoPorId") REFERENCES "Persona"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Movimiento" ADD CONSTRAINT "Movimiento_autorizadoPorId_fkey" FOREIGN KEY ("autorizadoPorId") REFERENCES "Persona"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Movimiento" ADD CONSTRAINT "Movimiento_transportistaId_fkey" FOREIGN KEY ("transportistaId") REFERENCES "Persona"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Movimiento" ADD CONSTRAINT "Movimiento_recibidoPorId_fkey" FOREIGN KEY ("recibidoPorId") REFERENCES "Persona"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Movimiento" ADD CONSTRAINT "Movimiento_cancelaAId_fkey" FOREIGN KEY ("cancelaAId") REFERENCES "Movimiento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoPartida" ADD CONSTRAINT "MovimientoPartida_movimientoId_fkey" FOREIGN KEY ("movimientoId") REFERENCES "Movimiento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoPartida" ADD CONSTRAINT "MovimientoPartida_articuloId_fkey" FOREIGN KEY ("articuloId") REFERENCES "Articulo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Existencia" ADD CONSTRAINT "Existencia_bodegaId_fkey" FOREIGN KEY ("bodegaId") REFERENCES "Bodega"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Existencia" ADD CONSTRAINT "Existencia_articuloId_fkey" FOREIGN KEY ("articuloId") REFERENCES "Articulo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
