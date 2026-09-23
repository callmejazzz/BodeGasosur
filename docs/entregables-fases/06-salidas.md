# Fase 6 — Salidas

| Campo | Referencia |
|---|---|
| Estado | En desarrollo: contrato, permisos y frontera SQL inicial |
| Versión objetivo | `v0.6.0` |
| Contrato | [Fase 6: Salidas](../decisiones-otros/04-fase-6-salidas.md) |
| Guía técnica | [Construcción de `src/lib/salidas/`](../decisiones-otros/05-guia-implementacion-salidas.md) |
| Archivos propios | `src/lib/permisos.ts`, `src/lib/permisos.test.ts`, `src/lib/db.ts`, `prisma/sql/despues/80-salidas.sql`, `prisma/migrations/20260923130000_retiro_recepcion/migration.sql`, `prisma/sql/fase6-frontera.test.ts` |

## Plan de desarrollo

1. Escribir el contrato de estados, permisos, idempotencia, cancelación y criterios de
   aceptación antes de implementar pantallas. ✅
2. Agregar permisos de lectura, captura, autorización, retiro y recepción. ✅
3. Proteger transiciones y partidas autorizadas con SQL y pruebas de escritura directa. ✅
4. Construir el dominio `src/lib/salidas/` con formulario, repositorio, errores, primitivas
   y servicio transaccional.
5. Implementar el consumo PEPS en PostgreSQL en un solo viaje, bloqueando capas y
   existencia en orden determinista.
6. Construir solicitud, autorización/rechazo, retiro y confirmación de recepción.
7. Agregar bandeja de pendientes y captura por unidad o caja reutilizando la frontera de
   normalización de Entradas.
8. Probar concurrencia, existencia insuficiente, autorización, idempotencia y doble clic
   contra PostgreSQL real y desde las Server Actions.
9. Conservar fuera de alcance el vale imprimible, por decisión comunicada el
   2026-09-23. ✅

## Base ya disponible

El esquema contiene `SOLICITADA`, `AUTORIZADA`, `RECHAZADA`, `RETIRADA`, `RECIBIDA`
y `CANCELADO`. `RETIRADA` registra la salida física y descuenta inventario;
`RECIBIDA` registra actor e instante de confirmación y cierra la salida. Entradas ya
crea las capas PEPS que esta fase deberá consumir.

## Avance de esta fase

- Contrato de estados, actores, cancelación, idempotencia, PEPS, seguridad y pruebas de
  aceptación escrito con dos diagramas de referencia.
- Permisos de lectura, captura, autorización, retiro y recepción agregados a la matriz.
  La puerta común verifica `puedeAutorizar` además del rol para autorización.
- Nueva migración: impide saltar estados, retirar sin autorización o sin consumos,
  editar partidas autorizadas y borrar salidas. Aplicada a la base de pruebas y a la
  base local de desarrollo; probada con escrituras directas en PostgreSQL.
- Una migración incremental cambia el enum `ENTREGADA` a `RETIRADA`, elimina la
  restricción transitoria y restaura `RECIBIDA` como estado final. La migración
  transitoria previa se conserva solo como historial aplicado; el SQL fuente para
  bases nuevas contiene directamente el contrato vigente. No habrá vale imprimible
  en esta fase.
- El servicio PEPS sigue pendiente; la restricción SQL comprueba consumos pero aún no
  demuestra que capas y existencias se descontaron juntas.

## Criterio de cierre

Ninguna salida puede retirarse sin autorización válida registrada ni dejar una existencia o capa
negativa. Repetir una acción debe devolver el mismo resultado sin duplicar consumo o folio.
Confirmar recepción debe guardar actor e instante sin mover inventario otra vez.
