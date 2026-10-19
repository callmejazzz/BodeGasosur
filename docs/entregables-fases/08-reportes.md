# Fase 8 — Reportes

| Campo | Referencia |
|---|---|
| Estado | Construida en la rama `feat-reportes`; pendiente de mezclar a `main` |
| Versión | `v0.8.0`, sin etiqueta todavía |
| Commits | En `feat-reportes`, por PR desde `fase-8-reportes` |
| Contrato | [Fase 8: Reportes y exportación](../contratos-otros/06-fase-8-reportes.md) |

## Construido

- **Reporte semanal del viernes**: por artículo y bodega, del saldo al inicio del sábado al
  saldo al cierre del viernes, con compras, salidas a estaciones, traspasos recibidos y
  enviados, devoluciones, ajustes y reversas en columnas separadas, el valor final sin y
  con IVA y las piezas sin costo. Cada fila cuadra: saldo inicial + altas − bajas = saldo
  final. Sin filtro de bodega, una tabla de totales por artículo en su unidad. Si se
  consulta el mismo viernes, el reporte se marca provisional.
- **Existencias por bodega y mínimo**: la existencia de hoy, su valor y el mínimo del
  artículo comparado en cada bodega, con «Bajo mínimo» primero. Lo inactivo con
  existencia sigue visible y sin indicador; un artículo sin existencia ni mínimo se
  encuentra buscándolo.
- **Kardex por artículo**: cada partida en cada bodega —un traspaso son dos filas— con el
  saldo corrido de esa bodega desde el saldo anterior al rango, el importe del movimiento
  redondeado por fragmento y las piezas sin costo. Las reversas quedan en su fecha y
  enlazan con el original. Un resumen por bodega acompaña al kardex.
- **Gasto acumulado por estación**: consumo neto de salidas que no son préstamo, menos las
  devoluciones ligadas a ellas, con las reversas compensando en su propia fecha. Por
  estación o por estación y artículo; con piezas sin costo, el importe se rotula «valor
  conocido».
- **Frecuencia de consumo**: cuántas salidas retiradas llevaron cada artículo, cuántas de
  ellas fueron préstamo, las unidades y el último retiro. Las revertidas dejan de contar.
- **Descarga en Excel** de los cinco reportes y de toda tabla de consulta: catálogos,
  usuarios, entradas, salidas, pendientes, traspasos, devoluciones, ajustes, préstamos,
  hojas de conteo y las tablas dentro de cada detalle. Mismos filtros, filas y orden que
  la pantalla, sin limitarse a la página que se ve; una hoja por tabla, con título,
  filtros y momento de generación; fechas de Excel y números como número.
- **Límites**: dos descargas activas por usuario hasta terminar de enviarse, tres libros
  armándose en el proceso y un tope por minuto, con 429 y `Retry-After`. El mismo pedido
  en curso se comparte y se entrega por flujo sin copiarlo; el botón ignora el segundo
  clic. Cada descarga queda en el registro del servidor con quién la generó, al terminar
  de enviarse y sin filtros ni filas.
- **Permiso `reportes:leer`** para Superadmin, Compras y Jefe, independiente de la facultad
  de autorizar. Cada descarga exige el permiso de su pantalla, también en el servidor.
- Los textos de estatus se mueven a [`src/lib/estatus.ts`](../../src/lib/estatus.ts) para
  que pantalla y Excel digan lo mismo; las listas que ya existían aceptan un tamaño de
  lote además de su página de 100.

## Archivos principales

| Área | Archivos |
|---|---|
| Consultas de reportes | [`src/lib/reportes/`](../../src/lib/reportes/): `hechos.ts`, `semanal.ts`, `existencias.ts`, `kardex.ts`, `gasto.ts`, `frecuencia.ts`, filtros, columnas y lo que lee cada pantalla |
| Excel | [`src/lib/exportar/`](../../src/lib/exportar/): el libro (`xlsx.ts`), la lectura por lotes (`lotes.ts`), el registro de descargas (`descargas.ts`) y las tablas de listas y detalles |
| Ruta y pantallas | [`src/app/exportar/[tabla]/route.ts`](../../src/app/exportar/[tabla]/route.ts), [`src/app/(sistema)/reportes/`](<../../src/app/(sistema)/reportes/>) |
| Interfaz | [`src/components/reportes/`](../../src/components/reportes/) y [`descargar-excel.tsx`](../../src/components/ui/descargar-excel.tsx) |
| Puerta de lectura | `consultarParaDescarga()` en [`src/lib/db.ts`](../../src/lib/db.ts) |
| Pruebas | [`reportes.test.ts`](../../src/lib/reportes/reportes.test.ts), [`frontera.test.ts`](../../src/lib/reportes/frontera.test.ts), [`xlsx.test.ts`](../../src/lib/exportar/xlsx.test.ts), [`lotes.test.ts`](../../src/lib/exportar/lotes.test.ts) y [`route.test.ts`](../../src/app/exportar/[tabla]/route.test.ts) |

## Ajustes respecto al plan inicial de la fase

No hubo migración: los reportes leen las tablas de la fase 7. La exportación no usa una
librería de Excel; el libro se escribe con el ZIP de Node y XML mínimo, lo que evita una
dependencia con historial de vulnerabilidades. Se escribe y comprime por partes, sin el XML
completo en memoria ni bloquear el servidor. Las decisiones de columnas, tope de filas,
fórmulas, límites y escritura por partes están en el §6 del contrato.

## Pendiente al cerrar

- Cuadrar importes en Supabase cuando tenga artículos y movimientos; hoy las pruebas usan
  datos controlados en PostgreSQL local. Sus 18 migraciones coinciden con el repositorio y
  los cinco reportes y las descargas ya corren ahí (PostgreSQL 17) con el usuario de la
  aplicación en solo lectura.
- La etiqueta `v0.8.0` al mezclar `feat-reportes` a `main`, y el despliegue en Sevalla.
