# Fase 6 — Salidas

| Campo | Referencia |
|---|---|
| Estado | Pendiente |
| Versión objetivo | `v0.6.0` |
| Commits | Ninguno |
| Archivos propios | Aún no existen |

## Plan de desarrollo

1. Cerrar con Compras si existe vale de salida, si se imprime y quién lo firma.
2. Escribir el contrato de estados, permisos, idempotencia, cancelación y criterios de
   aceptación antes de implementar pantallas.
3. Agregar permisos de lectura, captura, autorización, entrega y recepción.
4. Construir el dominio `src/lib/salidas/` con formulario, repositorio, errores, primitivas
   y servicio transaccional.
5. Implementar el consumo PEPS en PostgreSQL en un solo viaje, bloqueando capas y
   existencia en orden determinista.
6. Construir solicitud, autorización/rechazo, entrega y confirmación de recepción.
7. Agregar bandeja de pendientes y captura por unidad o caja reutilizando la frontera de
   normalización de Entradas.
8. Probar concurrencia, existencia insuficiente, autorización, idempotencia y doble clic
   contra PostgreSQL real y desde las Server Actions.

## Base ya disponible

El esquema ya contiene los estados `SOLICITADA`, `AUTORIZADA`, `RECHAZADA`, `ENTREGADA`,
`RECIBIDA` y `CANCELADO`, además de actores y marcas de tiempo. Entradas ya crea las capas
PEPS que esta fase deberá consumir.

## Criterio de cierre

Ninguna salida puede entregarse sin autorización vigente ni dejar una existencia o capa
negativa. Repetir una acción debe devolver el mismo resultado sin duplicar consumo o folio.
