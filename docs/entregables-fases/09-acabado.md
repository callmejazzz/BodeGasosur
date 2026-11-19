# Fase 9 - Acabado

| Campo | Referencia |
|---|---|
| Estado | Construida y publicada |
| Versión | `v0.9.0` |
| Commits | PR #24 y #27 a #30 en `feat/fase-9` y la rama `release/v0.9.0`, mezclados a `main` en el commit de `v0.9.0` |
| Contrato | [Fase 9: Acabado](../contratos-otros/07-fase-9-acabado.md) |

## Construido

La fase se construyó en cuatro entregas, cada una con su PR hacia `feat/fase-9`.

1. **Migración y preferencia privada (#24).**
   - `Usuario.alertasCorreo`, apagada por omisión, y las tablas `EvaluacionCorreos`, `LoteCorreos`, `RegistroCorreos` y `EventoCorreo`, con una evaluación por día y un envío por usuario y día. Sus filas no se borran y solo cambian de estado en las transiciones permitidas.
   - El índice único de correo de `Usuario` usa `lower(btrim(correo))`, el mismo criterio que la exclusión por dirección.
   - Los orígenes de sistema `resumen-diario` y `resend-webhook`, cada uno acotado a sus tablas.
   - La guarda de `Usuario` deja que cada usuario, con cualquier rol, cambie solo su propia `alertasCorreo`; nadie más la toca (`BG712`).
   - El permiso `cuenta:editar` y el apartado «Preferencias» en el perfil de Clerk.
2. **Alerta diaria por correo (#27 y #28).**
   - Cada día, a partir de las 8:00 de la Ciudad de México, «Stock bajo mínimo: N artículo(s)» con los artículos bajo mínimo; N cuenta artículos distintos. Sale con Resend y una plantilla de `react-email`.
   - Cada lote se reserva en la base antes de enviarse, con una llave de idempotencia estable: un reintento manda el mismo cuerpo y no duplica correos. Ninguna transacción queda abierta mientras se espera a Resend, y un arriendo corto evita que dos corridas manden el mismo lote.
   - La dispara una ruta protegida por secreto, que llama un proceso cron de Sevalla cada 15 minutos de 8:00 a 11:45. El día se evalúa una sola vez, y los lotes de días anteriores se cierran sin reenviarse.
   - Un webhook firmado de Resend registra entregas, rebotes y quejas. Solo asocia un evento a un envío si etiqueta, identificador y destinatario concuerdan; si no, lo guarda como anomalía.
   - Un rebote duro, una supresión o una queja excluyen esa dirección de las evaluaciones siguientes, sin tocar la preferencia. «Preferencias» muestra el último aviso con un solo estado y explica la exclusión.
3. **Tablero de inicio y barra lateral (#29).**
   - Cinco tarjetas de hasta 5 filas, cada una con su botón a la pantalla de la que sale: Existencias, Salidas, Préstamos, Entradas y Gasto mensual por estación.
   - En la barra lateral, cuántos pendientes tiene cada módulo de operación y cuántos artículos están bajo mínimo. REPORTES y CATÁLOGOS se despliegan, una a la vez.
   - El reporte de existencias cuenta artículos distintos bajo mínimo.
4. **Acabado de la interfaz (#30).**
   - Por debajo de 1024 px, una barra superior con menú en lugar de la barra lateral, y márgenes según el ancho de la pantalla.
   - Todas las pantallas usables a 375 px, con las tablas desplazándose dentro de su tarjeta.
   - Un diálogo propio de confirmación para toda acción irreversible, que pide ahí mismo el motivo cuando hace falta.
   - Mensajes que distinguen sesión terminada, usuario sin acceso, falta de permiso, regla de negocio y fallo del servidor o de la red.
   - Páginas propias de error y 404, y listas vacías que explican por qué y ofrecen la acción que las llena.

Con la publicación, debajo del nombre del usuario se ve la versión y su commit ([versionado y despliegue](../05-versionado-y-despliegue.md) §9).

## Archivos principales

| Área | Archivos |
|---|---|
| Base | La migración `20261107120000_correo_y_preferencia`, con el SQL a mano en [`997-correo-y-preferencia.sql`](../../prisma/sql/despues/997-correo-y-preferencia.sql) |
| Alerta diaria | [`src/lib/correo/`](../../src/lib/correo/): reserva, envío, conciliación, webhook, exclusión, corrida y plantilla; las rutas [`api/tareas/resumen-diario`](../../src/app/api/tareas/resumen-diario/) y [`api/webhooks/resend`](../../src/app/api/webhooks/resend/), y el script del cron [`disparar-resumen.mjs`](../../scripts/disparar-resumen.mjs) |
| Preferencia | [`src/lib/cuenta/`](../../src/lib/cuenta/), [`src/components/cuenta/`](../../src/components/cuenta/) y la acción en [`src/app/(sistema)/cuenta/`](<../../src/app/(sistema)/cuenta/>) |
| Tablero y barra lateral | [`src/lib/tablero/`](../../src/lib/tablero/), [`src/lib/navegacion/contadores.ts`](../../src/lib/navegacion/contadores.ts), [`tablero.tsx`](../../src/components/tablero.tsx) y [`navegacion.tsx`](../../src/components/navegacion.tsx) |
| Interfaz | [`dialogo.tsx`](../../src/components/ui/dialogo.tsx), [`mensajes.ts`](../../src/lib/mensajes.ts), [`conexion.ts`](../../src/lib/conexion.ts) y las páginas de error y 404 en [`src/app/`](../../src/app/) |
| Pruebas | Las de [`src/lib/correo/`](../../src/lib/correo/), [`tablero.test.ts`](../../src/lib/tablero/tablero.test.ts), [`contadores.test.ts`](../../src/lib/navegacion/contadores.test.ts) y las de acciones de cada módulo |

## Despliegue

La versión trae la migración `20261107120000_correo_y_preferencia`, que se aplica antes de desplegar la aplicación. El webhook de Resend y su secreto, las variables de la alerta y el proceso cron están en [versionado y despliegue](../05-versionado-y-despliegue.md) §8. Al publicar, el cron se ejecuta a mano una vez antes de dejarlo programado y el webhook se prueba con un evento de ejemplo desde el panel de Resend.

## Fuera de alcance

- La búsqueda global de artículo.
- Los datos de demostración con historia de varios meses.
- Las alertas por WhatsApp.
- Los mínimos por bodega y el alcance de usuarios por bodega.
- El monitor externo de la alerta diaria (Healthchecks.io), aprobado para `v1.0.0`.
