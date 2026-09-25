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
| [6 — Salidas](06-salidas.md)                                                | En desarrollo | objetivo `v0.6.0` | — | Dominio, conciliación SQL y Server Actions; falta la interfaz |
| [7 — Traspasos, devoluciones y conteo](07-traspasos-devoluciones-conteo.md) | Pendiente  | objetivo `v0.7.0`     | —                    | Movimientos entre bodegas y reversas de inventario             |
| [8 — Reportes](08-reportes.md)                                              | Pendiente  | objetivo `v0.8.0`     | —                    | Reportes operativos, kardex y exportación                      |
| [9 — Acabado](09-acabado.md)                                                | Pendiente  | objetivo `v0.9.0`     | —                    | Tablero, alertas y experiencia responsiva                      |

## Qué falta

El siguiente bloque funcional es la **fase 6**. Ya existen el servicio PEPS, el trigger
diferido de conciliación y las Server Actions; falta la interfaz. `RETIRADA` registra la salida de bodega y `RECIBIDA` cierra
la salida al confirmar la recepción, sin vale imprimible. Después siguen las fases 7, 8 y 9.

También permanecen tareas transversales para antes de `v1.0.0`: CI, destino de despliegue,
política de respaldos con prueba de restauración, observabilidad y cierre del registro de
usuarios por invitación.

> La Fase 5 está en `main` desde `d831f1e`, identificado por la etiqueta Git `v0.5.0`.
