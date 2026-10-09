# Fase 7 — Traspasos, devoluciones y conteo

| Campo    | Referencia                                                                                                |
| -------- | --------------------------------------------------------------------------------------------------------- |
| Estado   | Construida y publicada                                                                                    |
| Versión  | `v0.7.0`; correcciones de su revisión en `v0.7.1`                                                        |
| Commits  | `2ac6ca3` (`v0.7.0`); `22c1146` (`v0.7.1`); `afcea45` (selector, sin nueva versión)                       |
| Contrato | [Fase 7: Traspasos, devoluciones y conteo](../contratos-otros/05-fase-7-traspasos-devoluciones-conteo.md) |

## Construido

- **Traspasos** con borrador editable, alta idempotente por llave, descarte con motivo y
  confirmación transaccional: consumo PEPS en origen, una capa en destino por fragmento
  consumido con su fecha original y su par de costos, y folio `T-`. La valuación total
  no cambia, también con capas sin costo.
- **Devoluciones** vinculadas a una salida retirada o recibida de la misma estación,
  que regresan a la bodega de la que salió, limitadas al saldo por consumo, con capas
  que heredan costo y fecha original; o sin salida, a cualquier bodega, como ingreso de
  procedencia no comprobada, sin costo. Folio `D-`.
- **Préstamos** calculados desde consumos y capas: abiertos mientras falte cualquier
  pieza, cerrados solo con el retorno completo. La devolución sin salida no los reduce y
  la salida revertida deja de contar.
- **Hoja de conteo** por bodega con existencias leídas por el servidor, captura y
  corrección en borrador, actualización de existencias, revisión y confirmación que se
  rechaza si el stock cambió. Las diferencias se vuelven hasta dos `AJUSTE` (`A-`):
  capa sin costo para lo que sobra y consumo PEPS para lo que falta.
- **Reversas** de entradas, salidas retiradas o recibidas, traspasos, devoluciones y
  ajustes, solo por el Superadmin y con motivo: otro asiento ligado por `cancelaAId`
  que retira las capas exactas de un ingreso —bloqueado si ya se usaron— o restituye
  cada consumo de un egreso a su capa exacta mediante `RestitucionCapa`.
- **Frontera SQL**: conciliación diferida por movimiento, sobredevolución, reversa única
  y exacta, hoja confirmada igual a sus ajustes con la existencia en lo contado, máquina
  de estados de la hoja, inmutabilidad de restituciones y guardas de actor y bitácora
  para las tablas nuevas. Una entrada confirmada es exactamente una capa por partida.
  Cada migración revisa lo existente antes de terminar.
- Diez permisos nuevos, catorce Server Actions detrás de `accionProtegida()` y pantallas
  de lista, captura y detalle de traspasos, devoluciones, ajustes y hojas de conteo,
  además de préstamos. Entradas y salidas muestran su reversa, y las salidas su saldo,
  sus devoluciones y si volvieron completas o en parte («Devuelto», «Devuelto parcial»). Cada pantalla consulta solo lo que el usuario puede ver o usar.
- **Listas** de entradas, salidas, traspasos, devoluciones y ajustes ordenadas por grupo
  —abiertos, con folio de mayor a menor, cerrados sin folio—, búsqueda sin acentos en
  todas las pantallas que buscan, filtro de solo préstamos en salidas, filtro por fecha
  en hojas de conteo e insignias de estado hasta tres por renglón. La reversa de un
  traspaso no ocupa fila: queda en el historial del revertido, con folio y motivo.
- **Páginas de 100** en toda pantalla con lista —también préstamos, hojas de conteo,
  catálogos, pendientes de salidas y usuarios— y en las listas dentro de cada detalle,
  también al capturar; desde el registro 101 se pagina sin perder los filtros.
- **El selector de salida de una devolución se busca tecleando** y lee de 100 en 100
  bajo demanda en vez de precargar 500; valida la salida que llega en el enlace y, si no
  admite devolución, dice por qué.
- **Hora de la CDMX en la base**: los clientes SQL leen los instantes en
  `America/Mexico_City` cuando se configura toda la base, también las copias JSON de la
  bitácora; la aplicación conserva sesiones UTC para el adapter de Prisma. Si quien
  migra no es dueño de la base, la zona se configura solo para ese usuario y se avisa.
- 469 pruebas sobre PostgreSQL real, con concurrencia, idempotencia, doble clic,
  escrituras SQL directas, revocación a mitad de la acción y el JWT verificado por la base.

## Archivos principales

| Área                     | Archivos                                                                                                                                                                                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dominio                  | [`src/lib/inventario/`](../../src/lib/inventario/): captura, primitivas, traspasos, devoluciones, conteos, reversas, lecturas y pantallas                                                                                                                                                                                       |
| Primitivas compartidas   | [`src/lib/movimientos/primitivas.ts`](../../src/lib/movimientos/primitivas.ts): PEPS, capas y existencias de varias bodegas; [`lista.ts`](../../src/lib/movimientos/lista.ts): orden, búsqueda y página de las listas; [`src/lib/paginacion.ts`](../../src/lib/paginacion.ts): páginas de 100 |
| Server Actions y páginas | [`traspasos/`](<../../src/app/(sistema)/traspasos/>), [`devoluciones/`](<../../src/app/(sistema)/devoluciones/>), [`conteos/`](<../../src/app/(sistema)/conteos/>), [`ajustes/`](<../../src/app/(sistema)/ajustes/>), [`prestamos/`](<../../src/app/(sistema)/prestamos/>) y [`reversas/`](<../../src/app/(sistema)/reversas/>) |
| Interfaz                 | [`src/components/inventario/`](../../src/components/inventario/)                                                                                                                                                                                                                                                                |
| Permisos                 | [`src/lib/permisos.ts`](../../src/lib/permisos.ts)                                                                                                                                                                                                                                                                              |
| Esquema y frontera SQL   | [`prisma/schema.prisma`](../../prisma/schema.prisma), [`990-traspasos-devoluciones-conteo.sql`](../../prisma/sql/despues/990-traspasos-devoluciones-conteo.sql), [`991-devolucion-a-su-bodega.sql`](../../prisma/sql/despues/991-devolucion-a-su-bodega.sql), [`992-busqueda-sin-acentos.sql`](../../prisma/sql/despues/992-busqueda-sin-acentos.sql), [`993-hora-de-mexico.sql`](../../prisma/sql/despues/993-hora-de-mexico.sql), [`994-bitacora-en-hora-de-mexico.sql`](../../prisma/sql/despues/994-bitacora-en-hora-de-mexico.sql) y [`995-entrada-con-sus-capas.sql`](../../prisma/sql/despues/995-entrada-con-sus-capas.sql), con sus migraciones `20260929120000_traspasos_devoluciones_conteo`, `20261001100000_devolucion_a_su_bodega`, `20261001120000_busqueda_sin_acentos`, `20261001140000_hora_de_mexico`, `20261001150000_bitacora_en_hora_de_mexico` y `20261008100000_entrada_con_sus_capas` |
| Pruebas                  | [`fase7-frontera.test.ts`](../../prisma/sql/fase7-frontera.test.ts) y las de [`src/lib/inventario/`](../../src/lib/inventario/)                                                                                                                                                                                                 |
| Semillas de pruebas      | [`pruebas/semilla-operacion.ts`](../../pruebas/semilla-operacion.ts) y [`pruebas/semilla-inventario.ts`](../../pruebas/semilla-inventario.ts)                                                                                                                                                                                   |

## Ajustes respecto al plan inicial de la fase

La reversa quedó como `AJUSTE`, o como `TRASPASO` si revierte un traspaso, en lugar de
un tipo propio, y la devolución exacta a la capa original se registra en una tabla nueva,
`RestitucionCapa`. Los ajustes no se capturan sueltos: nacen de una hoja de conteo o de
una reversa. El detalle está en el §7 del contrato.

Para reutilizarlo, el PEPS de salidas se movió a las primitivas compartidas. La semilla
de pruebas ahora crea sus capas desde un ingreso confirmado, porque la base ya no acepta
capas sin un movimiento que las explique. Se corrigieron dos pruebas previas que
dependían del orden de marcas de tiempo iguales: la bandeja de salidas y la bitácora del
webhook.

## Correcciones posteriores a `v0.7.0`

La revisión del código etiquetado encontró tres huecos, corregidos en `v0.7.1`:

- **Entrada confirmada sin capas.** La conciliación revisaba que cada capa existente
  correspondiera a una partida, pero no exigía una capa por partida: una entrada escrita
  a mano podía confirmarse sin capas ni existencia. `995-entrada-con-sus-capas.sql`
  compara exactamente partidas y capas y extiende `movimientos_sin_conciliar()` a las
  entradas. Las pruebas de la fase 5 y de errores que confirmaban entradas a mano ahora
  crean su capa y su existencia, como la recepción.
- **Límites que ocultaban operaciones.** Préstamos mostraba solo 500 y el formulario de
  devoluciones elegía entre las 500 salidas más recientes. Las listas pasaron de tramos
  de 200 con cursor a páginas de 100, también dentro de los detalles, y el selector de
  salidas se busca tecleando y pagina en el servidor
  ([`selector-buscable.tsx`](../../src/components/ui/selector-buscable.tsx)).
- **Conteo confirmable tras un guardado fallido.** La hoja marcaba los cambios como
  guardados al enviar. Ahora la marca se limpia solo cuando el servidor devuelve la
  revisión guardada ([`cambios.ts`](../../src/lib/inventario/cambios.ts)).

Después de `v0.7.1`, `afcea45` corrigió la selección con Enter: una búsqueda con
resultados activa la primera salida y una búsqueda sin coincidencias no desvincula una
salida. Por decisión del proyecto, ese commit no tiene nueva etiqueta de versión.

El cuarto hallazgo —que la cuenta de ejecución escribe en las tablas y `fijar_actor` no
comprueba el rol de la operación— queda fuera, por decisión del 2026-10-08: los permisos
se exigen en las Server Actions, y desde la interfaz no hay forma de saltarlos.
