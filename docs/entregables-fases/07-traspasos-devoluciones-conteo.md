# Fase 7 — Traspasos, devoluciones y conteo

| Campo | Referencia |
|---|---|
| Estado | Pendiente |
| Versión objetivo | `v0.7.0` |
| Commits | Ninguno |
| Archivos propios | Aún no existen |

## Plan de desarrollo

1. Definir por contrato las reglas de traspaso, devolución, préstamo, ajuste físico y
   cancelación antes de escribir servicios.
2. Implementar traspasos que consuman capas en origen, creen capas en destino y conserven
   `fechaOriginal` y costo.
3. Implementar devoluciones ligadas a la salida original mediante `ConsumoCapa`.
4. Mantener préstamos abiertos hasta registrar el movimiento de retorno.
5. Construir hoja de conteo y ajustes por diferencias de inventario físico.
6. Implementar cancelaciones con asiento inverso sobre las capas exactas, sin borrar el
   movimiento original.
7. Agregar permisos, Server Actions, pantallas, repositorios y pruebas de concurrencia para
   cada tipo de movimiento.

## Base ya disponible

`Movimiento` ya contempla `TRASPASO`, `DEVOLUCION` y `AJUSTE`, relación de devolución,
préstamo, cancelación y bodegas de origen/destino. `CapaCosto` conserva la fecha original y
`ConsumoCapa` permite saber qué capas debe devolver una reversa.

## Criterio de cierre

Cada operación conserva la igualdad entre existencia y capas restantes. Un traspaso no
altera la valuación total, y una cancelación revierte exactamente el asiento original.
