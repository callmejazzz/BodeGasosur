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
| [7 — Traspasos, devoluciones y conteo](07-traspasos-devoluciones-conteo.md) | Construida | `v0.7.0`              | cierre integral local          | Traspasos, devoluciones, préstamos, conteo físico y reversas   |
| [8 — Reportes](08-reportes.md)                                              | Pendiente  | objetivo `v0.8.0`     | —                    | Reportes operativos, kardex y exportación                      |
| [9 — Acabado](09-acabado.md)                                                | Pendiente  | objetivo `v0.9.0`     | —                    | Tablero, alertas y experiencia responsiva                      |

## Qué falta

La **fase 7** está construida, probada y documentada en un único commit local.
`v0.7.0` es la versión del código; todavía no se ha distribuido. El siguiente bloque
funcional es la **fase 8**: reportes, kardex y exportación.
Después sigue la fase 9.

También permanecen tareas transversales para antes de `v1.0.0`: CI, destino de despliegue,
política de respaldos con prueba de restauración, observabilidad y cierre del registro de
usuarios por invitación.

> La Fase 6 tiene la etiqueta Git `v0.6.0`. El cierre de la Fase 7 permanece local,
> sin push ni etiqueta nueva.
