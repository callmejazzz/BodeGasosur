# Fase 6 — Salidas

| Campo            | Referencia                                                                                                                                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Estado           | En desarrollo: dominio, conciliación SQL y Server Actions construidos; falta la interfaz                                                                                                                       |
| Versión objetivo | `v0.6.0`                                                                                                                                                                                                        |
| Contrato         | [Fase 6: Salidas](../decisiones-otros/04-fase-6-salidas.md)                                                                                                                                                     |
| Guía técnica     | [Construcción de `src/lib/salidas/`](../decisiones-otros/05-guia-implementacion-salidas.md)                                                                                                                     |
| Archivos propios | `src/lib/salidas/`, `src/lib/movimientos/`, `src/app/(sistema)/salidas/actions.ts`, `pruebas/semilla-salidas.ts`, `src/lib/permisos.ts`, `prisma/sql/despues/80-salidas.sql`, `prisma/sql/despues/85-conciliacion.sql`, `prisma/migrations/20260923160000_consumo_unico/`, `prisma/migrations/20260924100000_conciliacion_inventario/` |

## Plan de desarrollo

1. Escribir el contrato de estados, permisos, idempotencia, cancelación y criterios de
   aceptación antes de implementar pantallas. ✅
2. Agregar permisos de lectura, captura, autorización, retiro y recepción. ✅
3. Proteger transiciones y partidas autorizadas con SQL y pruebas de escritura directa. ✅
4. Construir el dominio `src/lib/salidas/` con formulario, repositorio, errores, primitivas
   y servicio transaccional. ✅
5. Implementar el consumo PEPS en PostgreSQL en un solo viaje, bloqueando capas y
   existencia en orden determinista. ✅
6. Construir solicitud, autorización/rechazo, retiro y confirmación de recepción en el
   dominio. ✅
7. Agregar lectura de pendientes y normalización de captura por unidad o caja; conectar
   ambas con la interfaz. Dominio ✅; interfaz pendiente.
8. Probar concurrencia, existencia insuficiente, autorización, idempotencia y doble clic
   contra PostgreSQL real y desde las Server Actions. ✅
9. Conservar fuera de alcance el vale imprimible, por decisión comunicada el
   2026-09-23. ✅
10. Agregar un trigger diferido que concilie consumos, capas y existencias antes de
    exponer el retiro desde las Server Actions. ✅
11. Conectar las lecturas y las seis Server Actions a las pantallas. Actions ✅;
    interfaz pendiente.

## Base ya disponible

El esquema contiene `SOLICITADA`, `AUTORIZADA`, `RECHAZADA`, `RETIRADA`, `RECIBIDA`
y `CANCELADO`. `RETIRADA` registra la salida física y descuenta inventario;
`RECIBIDA` registra actor e instante de confirmación y cierra la salida. Entradas crea
las capas PEPS que el servicio de Salidas consume al retirar.

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
- `src/lib/salidas/` implementa el flujo completo en transacciones y las consultas de
  lista, detalle, pendientes y valuación. `src/lib/movimientos/` concentra las piezas
  que Salidas y Entradas comparten. Pruebas de integración cubren PEPS, carreras,
  rollback transaccional, idempotencia y recepción.
- La migración `20260923160000_consumo_unico` impide repetir una pareja
  `(partidaId, capaId)`. `85-conciliacion.sql` añade la comprobación diferida de
  consumo, capa y existencia, y evita editar o borrar capas y consumos ya escritos.
  El preflight de su migración comprueba los datos existentes antes de activar los
  triggers. Sus pruebas escriben directamente en PostgreSQL.
- Las seis Server Actions comprueban sesión y permiso antes de leer o validar datos.
  La puerta común relee usuario y permiso con `FOR SHARE` antes de confirmar la
  transacción. Las pruebas cubren acceso, revocación concurrente y errores seguros.
- El actor de cada escritura protegida se liga en PostgreSQL a un JWT RS256 de Clerk.
  Las migraciones 95–99 exigen la liga, protegen bitácora y columnas de actor y bloquean
  las lecturas de facultad y rol frente a revocaciones concurrentes. La plantilla dura
  30 segundos y la base admite hasta 60. Está implementado y probado en desarrollo;
  el despliegue a producción queda para el cierre de los entregables.
- La aplicación aún no presenta las pantallas de Salidas; la fase sigue abierta.

## Criterio de cierre

Ninguna salida puede retirarse sin autorización válida registrada ni dejar una existencia o capa
negativa. El consumo, la disminución de capas y la existencia deben conciliar también
ante escrituras SQL directas. Repetir una acción debe devolver el mismo resultado sin duplicar consumo o folio.
Confirmar recepción debe guardar actor e instante sin mover inventario otra vez.
