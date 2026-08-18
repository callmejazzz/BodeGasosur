# BodeGasosur — Plan de construcción de la demo

Orden pensado para que **en cada fase haya algo que enseñar** a Compras y provocar
retroalimentación, en lugar de construir tres semanas a ciegas.

> **Estado al 18/ago/2026:** fases 0 y 1 construidas y verificadas en local.
> La fase 2 es la siguiente.

## Fase 0 — Cimientos ✅

- Proyecto Next.js + TypeScript, Tailwind y shadcn/ui
- `docker-compose.yml` con PostgreSQL, `.env.example`
- Prisma con el esquema de `02-modelo-de-datos.md` y primera migración
- Layout base: navegación lateral, tipografía, identidad visual sobria

**Entregable:** la aplicación levanta en `localhost:3000` con base de datos conectada.

## Fase 1 — Catálogos y datos sembrados ✅

- CRUD de bodegas, estaciones, áreas, unidades, categorías, artículos, proveedores y personas
- `seed.ts` con datos verosímiles: 2–3 bodegas, 8–10 estaciones, ~40 artículos típicos
  de estación de servicio (filtros, aceites, papelería, uniformes, material de limpieza,
  equipo de seguridad), proveedores y personal

**Entregable:** el sistema ya "se parece" a Gasosur. Esta es la primera pantalla que vale
la pena enseñar: casi siempre corrigen nombres de estaciones y de áreas ahí mismo.

**Criterio de aceptación:** se pueden dar de alta y editar todos los catálogos sin tocar la base.

## Fase 2 — Entradas

- Captura de entrada: proveedor, referencia de factura/remisión, bodega destino, fecha,
  quién recibe, quién autoriza, observaciones
- Capturador de partidas con renglones dinámicos: artículo, cantidad, costo unitario, importe
- Confirmación transaccional: asigna folio, incrementa existencia, recalcula costo promedio
- Listado de movimientos con filtros y detalle imprimible

**Criterios de aceptación:**
- [ ] Al confirmar una entrada, la existencia de destino aumenta exactamente la cantidad capturada
- [ ] El costo promedio se recalcula correctamente contra un ejemplo hecho a mano
- [ ] Un borrador no afecta existencias
- [ ] El folio es consecutivo y sin huecos

## Fase 3 — Salidas

- Captura de salida: bodega origen, estación, área, solicitante, autorizador,
  transportista y vehículo, fecha, observaciones
- El costo unitario se toma del promedio de la bodega y se congela en la partida
- Validación de existencia suficiente (con el comportamiento que Compras defina — supuesto S5)
- Comprobante imprimible con espacios de firma

**Criterios de aceptación:**
- [ ] No se puede sacar más de lo que hay (o se advierte, según lo definido)
- [ ] El comprobante contiene todos los datos que Compras pidió: estación, área, quién
      autoriza, quién transporta, cantidad, costo y observaciones
- [ ] La existencia de origen disminuye exactamente lo capturado

## Fase 4 — Traspasos, ajustes y cancelaciones

- Traspaso entre bodegas en una sola operación transaccional
- Ajuste por conteo físico, merma o daño, con motivo obligatorio
- Cancelación de un movimiento confirmado generando el asiento inverso
- Comando `verificar-existencias` que recalcula desde el libro y reporta diferencias

**Criterios de aceptación:**
- [ ] Un traspaso deja el total global del artículo sin cambio
- [ ] Cancelar deja ambos movimientos visibles y enlazados; nada se borra
- [ ] La verificación reporta cero diferencias tras una batería de movimientos

## Fase 5 — Consultas y reportes

- Existencias por bodega, con resaltado bajo mínimo
- Kardex por artículo: entradas, salidas y saldo corrido
- Reporte de material enviado por estación y por área, con rango de fechas
- Reporte de compras por proveedor
- Exportación a Excel de todos los anteriores

**Entregable:** la parte que responde la pregunta original de Compras — *"saber hacia
qué estaciones se manda material"*.

## Fase 6 — Tablero y acabado

- Tablero de inicio: existencias bajas, últimos movimientos, gasto del mes por estación
- Búsqueda global de artículos
- Estados vacíos, mensajes de error claros, confirmaciones antes de acciones irreversibles
- Datos de demostración con historia de varios meses para que las gráficas tengan sentido

## Después de la demo

En este punto ya hay respuestas reales de Compras. Con ellas se decide el orden de:

1. Autenticación, usuarios y roles (Almacenista, Compras, Autorizador, Consulta)
2. Bitácora de auditoría de todas las acciones
3. Flujo de solicitud desde la estación (requisición → autorización → surtido)
4. Ciclo de compras (orden de compra, recepciones parciales)
5. Adjuntar la foto de la factura o del vale firmado
6. Despliegue en servidor y respaldos automáticos
7. Migración del histórico del Excel actual
