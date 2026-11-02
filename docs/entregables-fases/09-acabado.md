	# Fase 9 - Acabado

| Campo | Referencia |
|---|---|
| Estado | Pendiente |
| Versión objetivo | `v0.9.0` |
| Commits | Ninguno; la fase se construye en `feat/fase-9`, con un PR por entrega |
| Contrato | [Fase 9: Acabado](../contratos-otros/07-fase-9-acabado.md) |
| Archivos propios | Aún no existen |

## Plan de desarrollo

La fase se divide en cuatro entregas. Cada una se integra a `feat/fase-9` con su propio PR, y la fase llega a `main` en un solo PR al final.

1. **Migración y preferencia privada.**
   - Agregar la columna `Usuario.alertasCorreo`, desactivada por omisión.
   - Crear las tablas `EvaluacionCorreos`, `LoteCorreos`, `RegistroCorreos` y `EventoCorreo`, con una evaluación por día y un envío por usuario y día. Sus filas no se borran, y solo cambian de estado en las transiciones permitidas.
   - Agregar los orígenes de sistema `resumen-diario` y `resend-webhook`.
   - Reemplazar la guarda de `Usuario` para que cada usuario, con cualquier rol, cambie solo su propia `alertasCorreo`, y nadie más la toque (`BG712`).
   - Agregar el permiso `cuenta:editar` y la pantalla «Mi cuenta». Ahí cada usuario ve y cambia solo su propia preferencia.
2. **Alerta diaria por correo.**
   - Cada día a las 8:00 a. m., hora de la Ciudad de México, enviar «Stock bajo mínimo: N artículo(s)» con los artículos bajo mínimo; N cuenta artículos distintos.
   - Se envía con Resend gratuito y plantilla de `react-email`.
   - Cada lote se reserva en la base antes de enviarse y lleva una llave de idempotencia estable. Así, un reintento manda el mismo cuerpo y no duplica correos.
   - Ninguna transacción queda abierta mientras se espera a Resend; un arriendo corto evita que dos corridas manden el mismo lote.
   - La dispara una ruta protegida por secreto, llamada por un proceso cron de Sevalla cada 15 minutos de 8:00 a 11:45 para reintentar lo pendiente. Los lotes de días anteriores se cierran sin reenviarse.
   - El día se evalúa una sola vez y la evaluación queda registrada aunque no haya nada bajo mínimo ni destinatarios. Las corridas posteriores de ese día no vuelven a evaluar.
   - Un webhook firmado de Resend registra la entrega, los rebotes (duro, suave e indeterminado) y las quejas, y concilia los envíos con la misma regla que la respuesta del lote.
   - El webhook solo asocia un evento a un envío si etiqueta, identificador y destinatario concuerdan. Si no, lo guarda como anomalía, sin efecto en entregas ni exclusiones.
   - Un rebote duro, una supresión o una queja excluyen esa **dirección** de las evaluaciones siguientes, la use quien la use, sin tocar la preferencia.
3. **Tablero de inicio.** Sustituir el inicio demostrativo por cinco tarjetas:
   - Bajo mínimo.
   - Préstamos abiertos.
   - Salidas por autorizar y por retirar.
   - Entradas en borrador.
   - Las 5 estaciones de mayor gasto del mes.

   También mostrar en la navegación cuántos artículos están bajo mínimo.
4. **Acabado de la interfaz.**
   - Que las pantallas funcionen en celular y escritorio.
   - Estados vacíos y mensajes de error claros.
   - Páginas de error y 404 propias.
   - Un diálogo propio de confirmación para toda acción irreversible.

## Base ya disponible

- La regla de bajo mínimo y su consulta ya están en el reporte de existencias ([`existencias.ts`](../../src/lib/reportes/existencias.ts)). La alerta, el tablero y la navegación la reutilizan.
- El tablero lee las consultas que ya existen:
  - El gasto por estación de la fase 8.
  - Los préstamos de la fase 7.
  - La bandeja de salidas pendientes.
  - El listado de entradas.
- `escrituraDeSistema()` en [`db.ts`](../../src/lib/db.ts) ya sirve de puerta para un proceso sin usuario. La fase solo le agrega dos orígenes.
- La bitácora ya registra la fila completa de `Usuario` antes y después de cada cambio, y se queda así. La preferencia aparece ahí y solo ahí fuera de «Mi cuenta» (§2 del contrato).
- Ya existen los componentes de la interfaz: tablas, tarjetas, `EstadoVacio` y botones. Esta fase los ajusta para celular, en lugar de rehacerlos.

## Fuera de alcance

- La búsqueda global de artículo.
- Los datos de demostración con historia de varios meses.
- Las alertas por WhatsApp.
- Los mínimos por bodega y el alcance de usuarios por bodega.
- El dominio propio del remitente, que se verifica antes de `v1.0.0`. Mientras tanto, Resend solo entrega al correo de su propia cuenta.

## Criterio de cierre

- La alerta llega solo a los usuarios activos que la pidieron, una vez al día y nunca duplicada, aunque dos corridas coincidan o el proceso caiga entre Resend y la base.
- `ENVIADO` solo afirma que Resend aceptó el correo; «entregado» lo afirma el webhook. «Mi cuenta» muestra un solo estado sin contradicciones.
- Ningún lote queda `PENDIENTE` después de su día, y cada día se evalúa una sola vez.
- Ningún rebote ni entrega se atribuye a un envío con el que no concuerda.
- La preferencia de cada usuario solo la ven y la cambian ellos mismos.
- Las cifras del tablero coinciden con las pantallas a las que remite.
- Las pantallas se usan en celular y escritorio.
- Toda acción irreversible pide confirmación.
- Las pruebas del §8 del contrato pasan contra PostgreSQL real.
