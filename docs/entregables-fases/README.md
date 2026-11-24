# Entregables por fase

Cada expediente registra únicamente lo construido en la fase —o el plan vigente si todavía
no se construye— junto con sus archivos, commits y versión de referencia.

## Estado general

| Fase                                                                        | Estado     | Versión de referencia | Commit de referencia | Entrega                                                        |
| --------------------------------------------------------------------------- | ---------- | --------------------- | -------------------- | -------------------------------------------------------------- |
| [0 — Cimientos](00-cimientos.md)                                            | Construida | `v0.1.0`              | `fc28e83`            | Next.js, PostgreSQL, Prisma y base de la aplicación            |
| [1 — Catálogos](01-catalogos.md)                                            | Construida | `v0.1.0`              | `fc28e83`            | Catálogos configurables, formularios y datos demostrativos     |
| [2 — Cimientos corregidos](02-cimientos-corregidos.md)                      | Construida | `v0.2.0`              | `04986fe`            | Modelo corregido, invariantes SQL, auditoría y UUIDv7          |
| [3 — Usuarios y permisos](03-usuarios-y-permisos.md)                        | Construida | `v0.3.0`              | `7cc5203`            | Clerk, autorización en PostgreSQL y administración de usuarios |
| [4 — Migración de catálogos](04-migracion-catalogos.md)                     | Construida | `v0.4.0`              | `9ea85b5`            | Catálogo global real e inicio limpio de producción             |
| [5 — Entradas](05-entradas.md)                                              | Construida | `v0.5.0`              | `d831f1e` | Borradores, confirmación, costos, capas y existencias          |
| [6 — Salidas](06-salidas.md)                                                | Construida | `v0.6.0`              | `bd3d30e`–`8fe9805` | Solicitud, retiro PEPS, recepción y pantallas completas |
| [7 — Traspasos, devoluciones y conteo](07-traspasos-devoluciones-conteo.md) | Construida | `v0.7.0`, `v0.7.1`    | `2ac6ca3`, `22c1146` | Traspasos, devoluciones, préstamos, conteo físico y reversas   |
| [8 — Reportes](08-reportes.md)                                              | Construida | `v0.8.0` | PR #7 a #13 | Cinco reportes, kardex y exportación a Excel de toda tabla |
| [9 — Acabado](09-acabado.md)                                                | Construida | `v0.9.0`, `v0.9.1` | PR #24, #27 a #33 | Alerta diaria por correo, tablero, barra lateral y acabado para celular |

## Qué falta

La **fase 9** —alerta diaria por correo, tablero de inicio, barra lateral con pendientes y
acabado para celular— se construyó en la rama `feat/fase-9` con un PR por entrega (#24,
#27 a #30) y se publicó como `v0.9.0`; `v0.9.1` rediseña el correo de la alerta. Después
siguen las `v1.0.0-rc`, que se presentan a Gasosur para aprobación, y `v1.0.0`, con datos
reales.

Antes de `v1.0.0` quedan tareas transversales: la revisión de Sevalla y la aplicación
`bodegasosur-ops`, con respaldos cada hora y un ensayo de restauración al mes
([05](../05-versionado-y-despliegue.md) §8); la instancia de producción de Clerk; el
monitor externo de la alerta diaria, y el registro de usuarios solo por invitación. CI llega
después de `v1.0.0`.

> La Fase 6 tiene la etiqueta Git `v0.6.0`; la Fase 7, `v0.7.0`, y su parche, `v0.7.1`; la Fase 8, `v0.8.0`, y la Fase 9, `v0.9.0`, y su parche, `v0.9.1`.
