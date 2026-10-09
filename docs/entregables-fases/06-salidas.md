# Fase 6 — Salidas

| Campo        | Referencia                                                                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Estado       | Construida                                                                                                                                                                     |
| Versión      | `v0.6.0`                                                                                                                                                                       |
| Commits      | `bd3d30e` — contrato y frontera SQL; `6ef2605` — dominio, conciliación y acciones; `ae7741d` — actor verificable y guardas de acceso; `8fe9805` — pantallas; cierre de versión |
| Etiqueta Git | `v0.6.0`                                                                                                                                                                       |
| Contrato     | [Fase 6: Salidas](../contratos-otros/04-fase-6-salidas.md)                                                                                                                    |

## Construido

- Solicitud idempotente con bodega de origen, estación, solicitante, área, préstamo y
  partidas por unidad o caja.
- Autorización o rechazo con motivo por quien tiene `puedeAutorizar`; cancelación con
  motivo antes del retiro.
- Retiro transaccional: folio `S-`, consumo PEPS en una sola sentencia y descuento de capas
  y existencia con bloqueos en orden determinista.
- Confirmación de recepción con actor e instante, sin mover inventario; `RECIBIDA` cierra
  la salida.
- Restricciones SQL contra saltos de estado, retiro sin autorización o sin consumos,
  cambios a partidas autorizadas, consumos duplicados y borrado de salidas.
- Conciliación diferida de consumos, capas y existencia, e inmutabilidad de capas y
  consumos.
- Seis Server Actions que comprueban sesión y permiso antes de leer datos y los releen
  bajo candado antes de confirmar.
- Actor verificable: JWT RS256 de Clerk verificado en PostgreSQL y ligado a la bitácora,
  con guardas de privilegios en `Usuario`.
- Usuario de ejecución separado del de migraciones, con sus privilegios probados.
- Lista con búsqueda y filtros (cursor en `v0.6.0`, páginas de 100 desde `v0.7.1`);
  pendientes por sección; captura con existencia informativa; detalle con acciones,
  consumos PEPS, valuación e historial. Cada pantalla consulta solo lo que el usuario
  puede ver.
- 344 pruebas sobre PostgreSQL real, con concurrencia, idempotencia, doble clic,
  escrituras SQL directas y vectores Wycheproof para la firma.

## Archivos principales

| Área | Archivos |
|---|---|
| Dominio | [`src/lib/salidas/`](../../src/lib/salidas/) |
| Piezas compartidas con Entradas | [`src/lib/movimientos/`](../../src/lib/movimientos/) |
| Server Actions y páginas | [`src/app/(sistema)/salidas/`](<../../src/app/(sistema)/salidas/>) |
| Interfaz | [`src/components/salidas/`](../../src/components/salidas/), [`paginacion.tsx`](../../src/components/ui/paginacion.tsx) y [`filtros-en-url.ts`](../../src/components/ui/filtros-en-url.ts) |
| Permisos y puertas | [`src/lib/permisos.ts`](../../src/lib/permisos.ts) y [`src/lib/db.ts`](../../src/lib/db.ts) |
| Transiciones y conciliación | [`prisma/sql/despues/80-salidas.sql`](../../prisma/sql/despues/80-salidas.sql) y [`85-conciliacion.sql`](../../prisma/sql/despues/85-conciliacion.sql) |
| Privilegios y actor verificable | [`90-privilegios.sql`](../../prisma/sql/despues/90-privilegios.sql), [`95-actor-verificable.sql`](../../prisma/sql/despues/95-actor-verificable.sql) a [`99-facultad-bajo-candado.sql`](../../prisma/sql/despues/99-facultad-bajo-candado.sql), [`scripts/llaves-clerk.ts`](../../scripts/llaves-clerk.ts) y [`src/lib/seguridad/llaves.ts`](../../src/lib/seguridad/llaves.ts) |
| Pruebas de frontera | [`fase6-frontera.test.ts`](../../prisma/sql/fase6-frontera.test.ts), [`fase6-conciliacion.test.ts`](../../prisma/sql/fase6-conciliacion.test.ts), [`actor-verificable.test.ts`](../../prisma/sql/actor-verificable.test.ts), [`privilegios.test.ts`](../../prisma/sql/privilegios.test.ts) y [`src/app/(sistema)/salidas/actions.test.ts`](<../../src/app/(sistema)/salidas/actions.test.ts>) |
| Semilla de pruebas | [`pruebas/semilla-salidas.ts`](../../pruebas/semilla-salidas.ts) |

## Ajustes respecto al plan inicial de la fase

`ENTREGADA` se renombró a `RETIRADA`, y `RECIBIDA` quedó como cierre con actor e instante
de la confirmación. Por decisión comunicada el 2026-09-23 no se genera vale imprimible.

La conciliación diferida de consumos, capas y existencia se agregó antes de exponer el
retiro en las Server Actions. El actor verificable también entró en esta fase, antes de
las pantallas, para que el usuario de ejecución no pudiera atribuir cambios a otra
persona. Su despliegue a producción, en dos etapas, queda para el cierre de los
entregables.

Repetir un retiro con otro «entregado a» se trata como conflicto, igual que un motivo
distinto. La guía de implementación se retiró al cumplirse; el contrato conserva los
criterios de aceptación.
