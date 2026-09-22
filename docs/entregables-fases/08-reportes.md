# Fase 8 — Reportes

| Campo | Referencia |
|---|---|
| Estado | Pendiente |
| Versión objetivo | `v0.8.0` |
| Commits | Ninguno |
| Archivos propios | Aún no existen |

## Plan de desarrollo

1. Cerrar el contrato de columnas, filtros y cortes para cada reporte.
2. Construir el reporte semanal del viernes con entradas, salidas y existencia final.
3. Construir existencias por bodega, alerta de mínimos y conteo separado de piezas sin
   valuación.
4. Construir kardex por artículo, gasto acumulado por estación y frecuencia de consumo.
5. Definir e implementar exportación a Excel del lado del servidor para todos los
   listados, sin introducir cálculos monetarios paralelos en JavaScript.
6. Agregar permisos de consulta, paginación y filtros que puedan ejecutarse sobre el
   volumen esperado.
7. Verificar cada reporte contra consultas SQL de control y casos con costo desconocido.

## Dependencias funcionales

Los reportes completos necesitan las salidas y los movimientos de la fase 7. Entradas ya
aporta costos, capas, existencias, filtros y formatos reutilizables.

## Criterio de cierre

Los totales deben cuadrar con el libro de movimientos y distinguir claramente cantidad
valuada de cantidad sin costo conocido. Toda tabla debe poder exportarse con los mismos
filtros aplicados en pantalla.
