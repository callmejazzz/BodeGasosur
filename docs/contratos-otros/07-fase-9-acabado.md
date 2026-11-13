# BodeGasosur - contrato de la fase 9: Acabado

**Estado:** contrato de la fase 9, pendiente de construir; objetivo `v0.9.0`. Define la alerta diaria de stock mínimo por correo y su seguimiento de entrega, la preferencia de cada usuario, el tablero de inicio, las alertas en pantalla y el acabado de la interfaz. §9 se llenará con las decisiones que tome la construcción. Complementa el [expediente de la fase](../entregables-fases/09-acabado.md), el [modelo de datos](../02-modelo-de-datos.md) y el [contrato de reportes](06-fase-8-reportes.md), cuya regla de bajo mínimo se reutiliza sin cambios.

## 1. Resultado y límites

Cada usuario puede elegir si recibe, una vez al día, un correo con los artículos que están por debajo de su mínimo. Al entrar al sistema, el tablero muestra lo que pide atención: artículos bajo mínimo, préstamos abiertos, salidas por autorizar y por retirar, entradas en borrador y las estaciones con más gasto del mes. La navegación avisa cuántos artículos están bajo mínimo. Las pantallas funcionan en celular y escritorio. Los estados vacíos y los errores se explican, y toda acción irreversible pide confirmación.

Quedan fuera:
- La búsqueda global de artículo.
- Los datos de demostración con historia de varios meses.
- Las alertas por WhatsApp.
- Los mínimos distintos por bodega.
- El alcance de usuarios por bodega.
- Cualquier correo que no sea la alerta diaria.

El dominio del remitente, `gasosurnet.com`, ya está verificado en Resend (§3.8).

## 2. Preferencia de alertas por correo

- **Dato.** `Usuario.alertasCorreo`, booleano, `false` por omisión. Un usuario nuevo, dado de alta por el Superadmin o por el arranque, empieza sin alertas. La migración no enciende la preferencia de ningún usuario existente.
- **Quién la ve y la cambia.** Solo el propio usuario, desde el apartado «Preferencias» de su perfil: el modal de Clerk que se abre con su foto en la barra lateral. Nadie más puede verla ni cambiarla, tampoco el Superadmin:
  - El apartado no tiene ruta propia ni lleva identificador de usuario. Lectura y escritura toman siempre el usuario de la sesión, y cualquier identificador que llegue en el formulario se ignora.
  - La preferencia no aparece en la administración de usuarios, en su exportación a Excel ni en ninguna otra pantalla o descarga.
  - Las consultas de usuarios seleccionan campos explícitos, nunca la fila completa.
- **Permiso.** `cuenta:editar`, para los tres roles. Lo exige la Server Action en el servidor, igual que los demás permisos (`accionProtegida`), y la escritura toca solo esa columna de esa fila.
- **La guarda de `Usuario` en la base.** `cuenta:editar` no basta por sí solo: el trigger `usuario_exige_superadmin` rechaza con `BG708` toda escritura en `Usuario` cuyo actor verificado no sea un Superadmin activo, así que hoy un Jefe o Compras no podría guardar su preferencia. Una migración nueva reemplaza esa función (sin editar `96-actor-exigido.sql` ni `98-correcciones-actor.sql`) y agrega, antes de la regla del Superadmin:
  - **Cambio propio.** Si el actor verificado es la misma fila (`actor = NEW.id`), la fila estaba activa y lo único que cambia es `alertasCorreo` (aparte de `updatedAt`), se acepta con cualquier rol. Cualquier otro cambio a la propia fila sigue la regla del Superadmin.
  - **Nadie más la toca.** Un cambio de `alertasCorreo` con un actor distinto de la fila falla con `BG712`, aunque el actor sea Superadmin. Un alta con `alertasCorreo` encendida también falla con `BG712`.
  - **Webhook de Clerk.** Sin cambios: como `alertasCorreo` no está entre las columnas que puede tocar, cualquier cambio suyo a ella sigue fallando con `BG710`.
  - **Dueño de la base** (migraciones): sin cambios, conserva su paso.
  - **Candados.** El cambio propio decide con `OLD` y no lee otra fila, así que no agrega candados nuevos ni forma ciclo con la administración de accesos, que bloquea a los Superadmin con `FOR UPDATE`.
- **Bitácora.** `Usuario` está en la lista de `20-bitacora.sql`, y la bitácora guarda la **fila completa** antes y después de cada cambio (`to_jsonb(OLD)` y `to_jsonb(NEW)`). Se queda así a propósito:
  - Cada cambio de la preferencia deja un renglón con el propio usuario como actor y `alertasCorreo` en `antes` y `despues`.
  - Cualquier otro cambio a la fila (un cambio de rol, una baja, la sincronización de correo de Clerk) también lleva `alertasCorreo` en `antes` y `despues`, aunque no la toque.
  - La bitácora no tiene pantalla ni descarga en la aplicación; solo la consulta quien tiene acceso directo a la base. Es la **única excepción** a la privacidad de la preferencia.
- **Qué muestra el apartado «Preferencias».**
  - La preferencia.
  - El correo al que llegará la alerta, que es la copia sincronizada desde Clerk.
  - La hora de envío.
  - El último aviso del propio usuario, con su fecha y **un solo estado** de la tabla de §3.11. La evidencia de Resend prevalece sobre el estado del envío, así que nunca aparece un envío pendiente junto a una entrega realizada.
  - Los avisos de §3.11 que le apliquen: dirección excluida, «Empieza mañana» u «Hoy no hubo artículos bajo mínimo».
- **Usuario dado de baja.** Un usuario inactivo no recibe alertas aunque conserve la preferencia encendida. Al reactivarlo, vuelve a recibirlas sin que nadie la toque.

## 3. Alerta diaria de stock mínimo

### 3.1 Qué se considera bajo mínimo

Es la misma regla del reporte de existencias (§3.2 del [contrato de reportes](06-fase-8-reportes.md)): artículo activo, bodega activa y `Existencia.cantidad < Articulo.stockMinimo`, comparado en cada bodega. Mínimo cero nunca es bajo mínimo. Se lee la existencia actual al momento de la reserva (§3.4), en una sola sentencia sobre la consulta base del reporte; no se escribe una segunda versión de la regla. Como los usuarios no tienen alcance por bodega, todos los destinatarios reciben la misma lista.

**Cuántos artículos (N).** N es el número de **artículos distintos** bajo mínimo en al menos una bodega activa: un artículo que falta en dos bodegas cuenta una vez, aunque ocupe dos renglones de la tabla. Se calcula en la misma instantánea que los renglones, sobre la misma consulta, y no se acota con el tope de §3.3. El asunto del correo, el tablero (§4) y la navegación (§5) usan esta misma N.

### 3.2 Cuándo y a quién

- Se envía todos los días a partir de las **8:00 a. m., hora de la Ciudad de México**, con reintentos hasta las 11:45 si la primera corrida falla (§3.6).
- Los destinatarios se fijan en la evaluación del día (§3.4): usuarios **activos** con `alertasCorreo` encendida y cuya dirección de correo no está excluida (§3.7).
- **El día se evalúa una sola vez**, y la evaluación queda registrada aunque no se envíe nada. Una corrida posterior de ese mismo día no vuelve a evaluar, aunque después algún artículo baje de su mínimo o alguien encienda su preferencia.
- **Si no hay artículos bajo mínimo, no se envía nada**: no se reserva ningún lote y solo queda la evaluación del día. Tampoco se envía un correo «sin novedades».
- La fecha del envío es el día operativo en `America/Mexico_City`, calculado con las utilidades de [`fechas.ts`](../../src/lib/fechas.ts).

### 3.3 Contenido

- **Asunto:** «Stock bajo mínimo: N artículo» si N es 1 y «Stock bajo mínimo: N artículos» en otro caso, con la N de §3.1. Se arma en la reserva del día (§3.4) y es el mismo para todos los destinatarios.
- **Cuerpo:**
  - La fecha y N.
  - Una tabla agrupada por bodega. Cada grupo lleva solo el **nombre** de la bodega, sin su clave (`BDG-…`). Cada renglón lleva clave del artículo, descripción, unidad, existencia, mínimo y faltante (mínimo − existencia).
  - Orden: nombre de bodega, luego clave de artículo. El nombre de bodega es único, así que identifica cada grupo sin la clave.
- **Tope:** 50 renglones. Si hay más, el correo dice cuántos renglones faltan («y M renglones más») y remite al reporte.
- **Enlace:** uno al reporte de existencias con el filtro de bajo mínimo. La dirección se arma con la URL pública de la aplicación.
- **Cómo desactivarla:** el correo dice que la alerta se desactiva desde el perfil en BodeGasosur, apartado «Preferencias». No lleva enlace para desactivarla, porque el apartado vive en el modal de Clerk y no tiene dirección propia.
- **Formatos:** cada correo lleva versión HTML y versión de texto. Todo texto que venga de la base se escapa.
- **Plantilla:** se escribe con `react-email` y puede previsualizarse en local con datos de ejemplo.
- **Datos:** el correo no incluye importes ni costos.

### 3.4 Lotes, llave y reserva

- **Proveedor.** Resend, en su plan gratuito: 100 correos al día y 3,000 al mes, con un límite de 10 peticiones por segundo por equipo. Los correos se envían en lotes de hasta 100 por petición (`POST /emails/batch`), un lote a la vez. La llave de Resend vive solo en el servidor.
- **Una llave por lote.** Resend recibe la llave de idempotencia por **petición**, no por correo del lote. Cada lote tiene una llave estable, `resumen-<fecha>-<numero>` (por ejemplo `resumen-2026-10-30-1`). Resend la conserva 24 horas:
  - Misma llave y mismo cuerpo: devuelve la respuesta original sin volver a enviar.
  - Misma llave y otro cuerpo: `409 invalid_idempotent_request`.
  - Misma llave mientras otra petición sigue en curso: `409 concurrent_idempotent_requests`.
- **Tablas.** Ninguna de las tres entra en la bitácora de `20-bitacora.sql`, porque ellas mismas son el registro. El usuario de la aplicación no puede borrar sus filas.
  - **`EvaluacionCorreos`**, una fila por día evaluado, de solo inserción. Campos: fecha operativa (única), resultado (`CON_ENVIO`, `SIN_BAJO_MINIMO` o `SIN_DESTINATARIOS`), N, total de renglones, número de destinatarios, número de lotes e instante de la evaluación. Es lo que demuestra que el día ya se evaluó, incluso sin envíos.
  - **`LoteCorreos`**, una fila por petición a Resend. Campos:
    - Fecha operativa, número del día y llave (única).
    - Remitente, asunto, HTML, texto y N (artículos distintos bajo mínimo).
    - Estado: `PENDIENTE`, `ACEPTADO`, `RECHAZADO`, `VENCIDO` o `SIN_CONFIRMAR`.
    - Intentos, último intento y `arrendadoHasta` (§3.5).
    - Motivo, instante de creación e instante de resolución.

    Lleva `UNIQUE (fecha, numero)`.
  - **`RegistroCorreos`**, una fila por destinatario. Campos: lote, posición en el lote (0 a 99), fecha operativa, usuario, correo usado, estado (`PENDIENTE`, `ENVIADO`, `FALLIDO` o `SIN_CONFIRMAR`), identificador de Resend, motivo e instante de creación. Lleva `UNIQUE (fecha, usuarioId)`, `UNIQUE (loteId, posicion)`, `UNIQUE (resendId)` y un índice sobre la dirección normalizada (§3.7).
  - **Inmutables desde el alta:** el contenido del lote, la llave, los integrantes y su posición. Así el cuerpo guardado no puede cambiar entre un intento y otro. Un trigger solo deja pasar las transiciones de §3.5 y §3.6.
- **`ENVIADO` significa «aceptado por Resend».** Hay dos pruebas de aceptación: la respuesta exitosa de `batch.send` o cualquier evento de Resend sobre ese correo (§3.7). No afirma que el correo haya llegado al buzón.
- **Evaluación y reserva.** Es una transacción corta en `READ COMMITTED`, con estos pasos en orden:
  1. La primera sentencia toma `pg_advisory_xact_lock` por fecha.
  2. Si la fecha ya tiene `EvaluacionCorreos`, termina sin evaluar. Cuenta cualquier resultado, también uno sin envíos.
  3. Una **sola sentencia** sobre la consulta base del reporte devuelve tres cosas: los renglones bajo mínimo hasta el tope de §3.3, el total de renglones y N. Por ser una sola sentencia salen de la misma instantánea. Si N es cero, inserta la evaluación `SIN_BAJO_MINIMO` y termina.
  4. Lee los destinatarios: activos, con la preferencia encendida y con una dirección no excluida (§3.7), ordenados por id. Si no hay ninguno, inserta la evaluación `SIN_DESTINATARIOS` y termina.
  5. Genera el HTML y el texto una sola vez. Inserta los lotes de hasta 100, con número consecutivo, un `RegistroCorreos` `PENDIENTE` por integrante, con su posición, y la evaluación `CON_ENVIO`.

  Quien encienda su preferencia después de la evaluación empieza a recibir al día siguiente, sea cual sea el resultado.
- **Por qué la segunda corrida ve la primera evaluación.** Dos corridas simultáneas se forman en el candado. La segunda sigue después de que la primera confirma, porque PostgreSQL hace visible la confirmación antes de soltar el candado.
  - En `READ COMMITTED`, cada sentencia que sigue al candado ve lo ya confirmado, así que el paso 2 encuentra la evaluación de la primera corrida y termina. Esto vale igual cuando la primera no reservó nada.
  - **No se usa `REPEATABLE READ` en la reserva.** En ese nivel, la instantánea se fija en la primera sentencia, que es la del candado, y se toma *antes* de esperarlo. La segunda corrida no vería la evaluación y chocaría con el `UNIQUE`.
  - `UNIQUE (fecha)` de `EvaluacionCorreos` y `UNIQUE (fecha, usuarioId)` de `RegistroCorreos` quedan como última barrera: si algo fallara, la transacción se revierte entera en lugar de recorrer posiciones.

### 3.5 Envío y conciliación

- **Ninguna transacción queda abierta mientras se espera a Resend.** Cada lote se manda en tres pasos:
  1. **Arrendar.** Una transacción corta hace un `UPDATE` que sube `intentos`, fija el último intento y pone `arrendadoHasta = now() + 5 minutos`. Solo afecta al lote si es de la fecha de hoy y está libre, es decir, sin arriendo o con uno vencido. Además, el lote debe estar `PENDIENTE` o `ACEPTADO` con integrantes todavía `PENDIENTE`. Si no toca ninguna fila, el lote lo tiene otra corrida y se salta. El arriendo se confirma antes de llamar a Resend, así que el intento queda contado aunque el proceso caiga.
  2. **Llamar.** Se llama sin transacción y sin retener conexión. El cuerpo se arma solo con lo guardado: remitente, asunto, HTML y texto del lote, más el correo de cada integrante en orden de posición, con la etiqueta `registro=<id de RegistroCorreos>`. Va con la llave del lote y un tiempo de espera de 30 segundos. Nunca se vuelven a leer existencias ni usuarios, así que un reintento manda el mismo cuerpo, byte por byte.
  3. **Conciliar.** Una transacción corta aplica el resultado con la regla de abajo.
- **Duración de las transacciones.** Las tres son de milisegundos, porque ninguna espera a la red. El arriendo de 5 minutos dura más que el tiempo de espera de 30 segundos, así que dos corridas no llaman a Resend por el mismo lote a la vez. Si llegara a pasar, Resend responde `409 concurrent_idempotent_requests` y no duplica.
- **Respuesta lenta.** A los 30 segundos se aborta la llamada y no se escribe nada. El lote sigue `PENDIENTE`, con el intento contado.
  - Si Resend sí lo recibió, la siguiente corrida, ya vencido el arriendo, manda la misma llave y obtiene la respuesta original.
  - Si Resend no lo recibió, la siguiente corrida lo envía por primera vez.
  - En los dos casos sale una sola vez. Mientras tanto, el webhook puede conciliar por su lado (§3.7).
  - Si la respuesta tardía llega después de abortar, se descarta.
- **Qué pasa según la respuesta.** Se clasifica por el código HTTP y el tipo de error (`name`) que devuelve Resend, nunca por su mensaje:
  - **Éxito:** se concilia la aceptación de cada integrante, cuya posición `i` en `data` corresponde a la posición `i` del lote.
  - **Rechazo de los datos** (`400` o `422` de validación: `validation_error`, `invalid_parameter`, `missing_required_field`, `invalid_idempotency_key` o `invalid_attachment`): la petición no es válida y repetirla no sirve. El lote queda `RECHAZADO` y sus integrantes `FALLIDO` con el motivo, salvo los que ya estén `ENVIADO`. Si el lote ya estaba `ACEPTADO` porque antes llegó un evento asociado, sigue así: sus integrantes `PENDIENTE` pasan a `SIN_CONFIRMAR`, porque pudieron haber salido, y no se vuelven a pedir. Los demás lotes siguen.
  - **Rechazo pasajero** (`409 concurrent_idempotent_requests`, `429` que no sea de cuota, `5xx`, tiempo agotado o fallo de red): no se escribe nada. El lote espera a que venza su arriendo y lo retoma la siguiente corrida.
  - **Incidente operativo:** el fallo no depende de los destinatarios y se repara fuera del sistema. Nadie queda `FALLIDO`: el lote sigue `PENDIENTE` con el motivo, la corrida no intenta más lotes y el día queda no sano. Ya reparado, la siguiente corrida lo envía con la misma llave.
    - **Autenticación:** `401` o una llave inválida (`missing_api_key`, `restricted_api_key` o `invalid_api_key`).
    - **Remitente:** cualquier otro `403`, como el dominio sin verificar (§3.8), o `invalid_from_address`.
    - **Cuota:** `daily_quota_exceeded` o `monthly_quota_exceeded`.
    - **Operativo:** cualquier otro código o tipo de esta lista. Ante lo desconocido, nadie se marca `FALLIDO`.
  - **`409 invalid_idempotent_request`:** indica que el cuerpo cambió, lo cual no debe pasar. El lote queda `SIN_CONFIRMAR`, se deja una línea de error y no se reenvía.
  - **El motivo** es una descripción propia con el código y el tipo, por ejemplo «Resend rechazó la llave de la API (401 restricted_api_key)». El mensaje de Resend no se guarda ni se registra, porque puede traer direcciones. Cuando el lote pasa a `ACEPTADO` o el registro a `ENVIADO`, su motivo se borra: un estado de éxito no conserva el de un fallo anterior.
- **Regla de conciliación.** La aplican la respuesta de `batch.send` y el webhook (§3.7), en cualquier orden y las veces que haga falta, con el mismo resultado:
  - **Orden de candados.** Primero el lote (`FOR UPDATE`) y luego sus registros por posición. Los dos escritores siguen ese orden, así que no forman ciclo.
  - **Registro.** El hecho que se concilia es el par (registro, identificador de Resend):
    - Sin identificador: lo toma y pasa a `ENVIADO`, venga de `PENDIENTE`, `SIN_CONFIRMAR` o `FALLIDO`.
    - Con el mismo identificador: no cambia nada.
    - Con otro identificador: no se sobrescribe. Desde el webhook este caso no llega a la conciliación, porque el evento ya se marcó como anómalo (§3.7). Desde la respuesta del lote, deja una línea de error, y los eventos posteriores de ese otro identificador quedan como anomalía.

    `ENVIADO` es final y el identificador se fija una sola vez.
  - **Lote.** Si un solo integrante tiene prueba de aceptación, la petición fue aceptada: el lote pasa a `ACEPTADO` desde cualquier estado, y `ACEPTADO` es final. Un lote `ACEPTADO` con integrantes todavía `PENDIENTE` puede volver a pedirse ese día con la misma llave, y Resend devuelve la respuesta original con los identificadores que faltan.
  - **Rechazo.** Un rechazo solo cambia lo que sigue `PENDIENTE`: nunca pisa un `ENVIADO` ni un `ACEPTADO`. En un lote `ACEPTADO`, sus integrantes `PENDIENTE` pasan a `SIN_CONFIRMAR`, no a `FALLIDO`.

### 3.6 Recuperación y cierre

- **Ejecutor.** El cron de Sevalla corre cada 15 minutos de 8:00 a 11:45 (`*/15 8-11 * * *`), 16 corridas al día. Cada corrida hace, en orden:
  1. Cierra los lotes de fechas anteriores, en tandas de 20.
  2. Evalúa y reserva, si el día aún no tiene evaluación.
  3. Envía los lotes del día que lo necesiten (§3.5).

  La primera corrida que funciona evalúa el día, y las demás solo reintentan lo pendiente. Cada paso empieza solo si cabe en el plazo de la corrida (§3.9).
- **Cierre parcial.** Los atrasos solo usan el tiempo que sobra después de apartar la evaluación y un lote de hoy: la alerta del día va primero. Cada tanda es una transacción corta que toma los candados por fecha y número. Si no alcanza el tiempo, lo que queda lo cierra la siguiente corrida, y la respuesta lo indica con `cierrePendiente`.
- **Límite del mediodía.** La corrida vuelve a mirar la hora antes de evaluar y antes de cada lote. A partir de las 12:00 no empieza ninguno, aunque la corrida haya empezado antes, y responde `detenidaPor: "MEDIODIA"`. Lo que quede `PENDIENTE` lo cierra la corrida del día siguiente.
- **No hay ejecución garantizada.** Si Sevalla no ejecuta ninguna corrida en la ventana, ese día no hay alerta. Se nota porque no hay evaluación del día ni líneas en el registro del servidor. Lo que sí se garantiza:
  - A lo más un correo por persona al día.
  - Reintentos durante toda la ventana.
  - Que nada se quede `PENDIENTE` para siempre.
- **Fechas anteriores.** Un lote de una fecha anterior **nunca se envía**: su contenido ya es viejo y la evaluación del día lo reemplaza. Al cerrarlo:
  - `PENDIENTE` sin intentos: pasa a `VENCIDO`, y sus integrantes a `FALLIDO` con el motivo «no se envió a tiempo». Es seguro, porque nunca llegó a Resend.
  - `PENDIENTE` con intentos: pasa a `SIN_CONFIRMAR`, junto con sus integrantes, porque pudo haber llegado a Resend.
  - `ACEPTADO` con integrantes sin identificador: esos integrantes pasan a `SIN_CONFIRMAR`.

  Un evento posterior de Resend todavía puede llevar a `ENVIADO` a cualquiera de ellos (§3.5).
- **Vigencia de la llave.** Solo se envían o reintentan lotes de la fecha de hoy, y la fecha empieza a las 0:00. Por eso todo reintento ocurre a menos de 24 horas de la reserva, mientras Resend conserva la llave.

### 3.7 Seguimiento de entrega

- **Ruta.** `POST /api/webhooks/resend` recibe los eventos de Resend. No usa la sesión de Clerk: verifica la firma (encabezados `svix-id`, `svix-timestamp` y `svix-signature`) sobre el cuerpo crudo, con `resend.webhooks.verify` y el secreto `RESEND_WEBHOOK_SECRET`. Si la firma no es válida, responde 400 sin detalles y no escribe nada.
- **Eventos suscritos.** `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.failed` y `email.suppressed`. Las aperturas y los clics no se rastrean.
- **Registro.** `EventoCorreo` solo admite inserciones y no entra en la bitácora. Campos:
  - `svixId` (único), tipo de evento e identificador de Resend.
  - Asociación: el `RegistroCorreos` al que pertenece o, si es anómalo, el código de la anomalía y el valor de la etiqueta `registro` recibida. Una restricción exige exactamente uno de los dos.
  - Clasificación del rebote (`PERMANENTE`, `TRANSITORIO` o `INDETERMINADO`) y su subtipo.
  - Motivo de `email.failed` (`data.failed.reason`) o tipo de supresión (`data.suppressed.type`).
  - Instante del evento según Resend e instante de recepción.

  No se guardan destinatario, asunto, mensaje del rebote ni códigos de diagnóstico, porque pueden traer la dirección de correo.
- **Asociación con el envío.** Todo correo de la alerta lleva la etiqueta `registro`, que Resend incluye en todos los eventos `email.*`. Cada evento firmado cae en uno de tres casos:
  - **Ajeno:** sin etiqueta `registro` y con un `data.email_id` que no está en `RegistroCorreos`. Es un correo que no es de la alerta: se responde con 200 y no se guarda.
  - **Asociado:** solo si **todo concuerda**:
    1. La etiqueta `registro` apunta a un `RegistroCorreos` que existe.
    2. La dirección normalizada de ese registro está en `data.to`.
    3. Si el registro ya tiene identificador de Resend, es igual a `data.email_id`.
    4. `data.email_id` no es el identificador de otro registro.

    Se guarda ligado al registro y es el único caso que cuenta para la conciliación, el estado de entrega y la exclusión.
  - **Anómalo:** cualquier otro evento que apunte a la alerta por algún lado, ya sea por la etiqueta o por el identificador. Se guarda sin ligarlo a ningún registro, con su código, y deja una línea de error sin direcciones en el registro del servidor. No concilia, no cambia ningún estado de entrega y no excluye ninguna dirección: un rebote o una entrega mal correlacionados nunca se atribuyen a otra persona. Se responde con 200, porque un reintento de Resend no lo corregiría.

  Códigos de anomalía:
  - `ETIQUETA_DESCONOCIDA`: la etiqueta no corresponde a ningún registro.
  - `SIN_ETIQUETA`: el identificador es de un registro, pero el evento no trae etiqueta.
  - `ETIQUETA_E_ID_DISCREPAN`: la etiqueta y el identificador apuntan a registros distintos.
  - `DESTINATARIO_DISTINTO`: la dirección del registro no está en `data.to`.
  - `ID_DISTINTO`: el registro ya tiene otro identificador de Resend.
- **Todo evento asociado prueba la aceptación.** Antes de guardar su clasificación, cualquier evento asociado (no solo `email.sent`) aplica la conciliación de §3.5 con su identificador. Por eso un `email.delivered` cuyo `email.sent` nunca llega deja de todas formas el registro `ENVIADO`, y el envío nunca aparece pendiente junto a una entrega realizada.
- **Rebotes.** Se clasifican por `data.bounce.type`, no por el nombre del evento: la documentación de Resend no aclara si un rebote temporal llega como `email.bounced` o como `email.delivery_delayed`, y nombra el tipo `Transient` o `Temporary` según la página.
  - `Permanent`: **rebote duro**. Final: no se entregó y no se entregará.
  - `Transient` o `Temporary`: **rebote suave**. Provisional, porque todavía puede entregarse.
  - `Undetermined` o cualquier valor desconocido: **indeterminado**. Provisional.
- **Estado de entrega.** Los eventos se repiten (el mismo `svix-id` no inserta otra fila) y llegan en cualquier orden. Por eso la entrega se calcula con precedencia sobre todos los eventos asociados al registro, no por orden de llegada:
  1. **Marcado como spam** (`email.complained`).
  2. **No entregado**: rebote duro, `email.failed` o `email.suppressed`.
  3. **Entregado** (`email.delivered`).
  4. **Entrega demorada**: rebote suave, rebote indeterminado o `email.delivery_delayed`. Lo supera una entrega posterior.
  5. **Aceptado por Resend**, si no hay eventos.

  Un rebote duro prevalece sobre «entregado» aunque llegue después: el servidor aceptó el mensaje y luego lo rechazó.
- **Exclusión por dirección.** Un rebote duro, una supresión o una queja hacen que Resend suprima esa **dirección** en adelante, sin importar qué cuenta la use. Por eso, la exclusión sigue a la dirección y no al usuario:
  - **Dirección normalizada:** `lower(trim(correo))`. Hoy el índice único de correo de `Usuario` usa solo `lower(correo)`; la migración de la fase lo reemplaza por `lower(trim(correo))` para que ambos usen el mismo criterio. Ese índice solo aplica a usuarios activos, así que una cuenta dada de baja puede conservar una dirección que otra cuenta reutiliza.
  - **Dirección excluida:** la que tiene, en el historial completo de `RegistroCorreos`, al menos un registro con esa dirección normalizada y un evento **asociado** de rebote duro, supresión o queja. No importa a qué usuario pertenecía ese registro.
  - **Reserva:** la evaluación del día consulta ese historial con la dirección **actual** de cada candidato. Queda fuera quien tenga una dirección excluida, aunque nunca le haya rebotado a él. Eso cubre tres casos:
    - Una cuenta nueva con una dirección que ya rebotó en otra cuenta.
    - Un cambio de correo en Clerk hacia una dirección ya excluida.
    - El regreso a una dirección propia que se había excluido.
  - **Fin de la exclusión:** solo termina cuando el usuario pasa a una dirección no excluida.
  - La preferencia no se toca: solo el propio usuario la cambia (§2).
  - El apartado «Preferencias» le explica que su dirección actual está excluida y por qué tipo de evento, sin decir qué cuenta lo recibió.
  - Los eventos anómalos no excluyen.
  - Limitación conocida: si alguien quita la dirección de la lista de supresión en el panel de Resend, la exclusión sigue mientras la dirección sea la misma.
- **Respuesta.** La ruta responde 200 solo después de confirmar la escritura. Si la base falla, responde 500 y Resend reintenta.
- **Qué se afirma.** «Entregado» significa que el servidor de correo del destinatario aceptó el mensaje (`email.delivered`), no que la persona lo haya leído. La interfaz nunca dice «leído».

### 3.8 Remitente

`gasosurnet.com` es el dominio de Gasosur y ya está verificado en Resend. Los correos salen de su subdominio `avisos.gasosurnet.com`, que es el que se dio de alta y separa la reputación de envío del dominio principal. Con ese remitente, Resend acepta cualquier destinatario, así que ya no hace falta limitar la alerta al correo de la cuenta de Resend. El remitente se configura con la variable de entorno `CORREO_REMITENTE`, así que cambiarlo no requiere tocar código.

Si `CORREO_REMITENTE` usa un dominio sin verificar, Resend responde `403 validation_error`. Lo mismo pasa con `onboarding@resend.dev` para cualquier destinatario que no sea el correo de la cuenta de Resend. Ese rechazo no depende de los destinatarios, así que es un incidente de remitente (§3.5): el lote sigue `PENDIENTE` con el motivo, nadie queda `FALLIDO` y la corrida no intenta más lotes.
- Si se verifica el dominio dentro de la ventana, la siguiente corrida envía el mismo lote con la misma llave.
- Si el problema es el valor de `CORREO_REMITENTE`, los lotes del día ya guardaron ese remitente y no cambian. Corregirlo aplica desde la evaluación del día siguiente, y los lotes del día se cierran con las reglas de §3.6.

### 3.9 Disparo programado

- Una ruta del servidor, `POST /api/tareas/resumen-diario`, ejecuta una corrida (§3.6).
- No usa la sesión de Clerk. Su única protección es un secreto compartido que llega en `Authorization: Bearer …` y se compara en tiempo constante.
- Sin secreto, o con uno incorrecto, responde 401 sin detalles y sin leer la base. `CRON_SECRET` debe tener al menos 32 caracteres; si no, toda llamada recibe 401.
- **Ventana.** Solo corre de 8:00 a 12:00 de la Ciudad de México, sin incluir las 12:00, para no rechazar la corrida de las 11:45 ni su reintento. Fuera de ella responde 409 `FUERA_DE_VENTANA` con la hora de México, sin tocar la base, y deja una línea de error: así un cron que quedó en UTC se nota en vez de dar corridas sin correos.
- **Plazo.** Cada petición tiene 120 segundos, que empiezan a contar al llegar. Es un **control de admisión de pasos**, no una cancelación:
  - Una tanda de cierre, la evaluación o un lote solo empieza si su peor duración cabe en lo que queda, apartando lo necesario para leer el estado del día y responder.
  - La peor duración suma la espera de conexión, el tope de su transacción y, en un lote, los 30 segundos de Resend.
  - El plazo no interrumpe un paso ya empezado, que se acota con sus propios topes, y la lectura final del estado del día siempre se hace.
  - Dentro de la base, cada transacción tiene su propio tope (`statement_timeout` y `lock_timeout`), así que ninguna espera de candado lo rebasa.
  - Si el plazo no alcanza, la respuesta lo indica con `detenidaPor: "PLAZO"`, y lo pendiente queda para la siguiente corrida.
- **Respuesta.** Con el secreto correcto y dentro de la ventana devuelve en JSON:
  - el identificador de la corrida;
  - el resultado de la evaluación del día;
  - cuántos lotes y destinatarios quedaron en cada estado;
  - `diaSano` y sus motivos;
  - si se detuvo por plazo, mediodía o incidente, y cuál incidente.

  Si la corrida falla, responde 500 con el identificador de la corrida. El registro del servidor solo lleva la clase y el código del error y ese identificador, nunca mensajes ni direcciones.
- La dispara un proceso **Cron job** de Sevalla en la misma aplicación, con zona horaria `America/Mexico_City` y horario `*/15 8-11 * * *`. Una llamada extra, manual o repetida, es segura: no evalúa dos veces y solo retoma lo que lo necesita.

### 3.10 Acceso a la base sin usuario

Ni el proceso ni el webhook de Resend tienen sesión, así que entran por `escrituraDeSistema()` de [`db.ts`](../../src/lib/db.ts) con dos orígenes nuevos y cerrados. Cada origen recibe un cliente recortado a sus tablas:
- **`resumen-diario`:** lee existencias, usuarios y el historial de exclusión, e inserta en `EvaluacionCorreos`. También escribe en `LoteCorreos` y `RegistroCorreos`.
- **`resend-webhook`:** inserta en `EventoCorreo`, asociado o anómalo, y aplica la conciliación de §3.5 en `LoteCorreos` y `RegistroCorreos`.

En la base, `seguridad.actor_de_la_escritura` acepta cada origen únicamente para sus tablas, y los triggers de guarda de esas tablas lo consultan. Cualquier otra escritura con esos orígenes falla igual que una escritura sin actor (`BG706`).

### 3.11 Catálogo de estados

Los estados viven en cuatro niveles: el día, la petición a Resend, cada destinatario y cada evento de Resend. Lo que ve el usuario en el apartado «Preferencias» se calcula a partir de ellos.

**`EvaluacionCorreos.resultado`: el día.** Una fila por fecha; nunca cambia.

| Resultado | Qué significa | Cuándo aparece |
|---|---|---|
| `CON_ENVIO` | Hubo artículos bajo mínimo y destinatarios; se reservaron lotes | Primera corrida del día que funciona |
| `SIN_BAJO_MINIMO` | No había artículos bajo mínimo; no se reservó nada | Primera corrida del día que funciona, con N igual a cero |
| `SIN_DESTINATARIOS` | Había artículos bajo mínimo, pero nadie con la preferencia encendida y una dirección no excluida | Primera corrida del día que funciona, sin candidatos |

**`LoteCorreos.estado`: la petición a Resend.** Una fila por petición a `batch.send`, con hasta 100 destinatarios.

| Estado | Qué significa | Cuándo aparece | Puede pasar a |
|---|---|---|---|
| `PENDIENTE` | Reservado, pero todavía no hay respuesta de Resend | Al reservar el día. Sigue así tras un fallo pasajero (red, `429` que no sea de cuota, `5xx`, `409` concurrente, más de 30 segundos sin respuesta), tras un incidente operativo (llave, remitente, cuota u otra causa ajena a los destinatarios), que deja su motivo, o si el proceso cae antes de registrar la respuesta | Cualquiera de los de abajo |
| `ACEPTADO` | Resend aceptó la petición | Cuando llega la respuesta exitosa, o el primer evento asociado de cualquiera de sus correos (lo que ocurra primero) | Ninguno; es final |
| `RECHAZADO` | Resend rechazó los datos de la petición de forma definitiva | Con un `400` o `422` de validación (§3.5). Un `401`, un `403`, una cuota agotada u otra causa ajena a los destinatarios no lo producen: son incidentes y el lote sigue `PENDIENTE` | `ACEPTADO`, solo si después llega un evento asociado que lo contradiga |
| `VENCIDO` | Se acabó su día y nunca se intentó enviar | La corrida de un día posterior lo cierra si tenía 0 intentos. Es seguro: nunca llegó a Resend | `ACEPTADO`, solo con un evento asociado (no debería pasar) |
| `SIN_CONFIRMAR` | Pudo haber llegado a Resend, pero no se sabe | Se acabó su día con intentos y sin respuesta, o Resend respondió `409 invalid_idempotent_request`. No se reenvía, porque podría duplicar el correo | `ACEPTADO`, si llega un evento asociado de alguno de sus correos |

El lote también lleva `intentos`, el último intento y `arrendadoHasta`, pero no son estados. `arrendadoHasta` solo indica que una corrida lo tiene tomado durante 5 minutos.

**`RegistroCorreos.estado`: cada destinatario.**

| Estado | Qué significa | Cuándo aparece | Puede pasar a |
|---|---|---|---|
| `PENDIENTE` | Está en un lote que todavía no tiene respuesta | Al reservar | Cualquiera de los de abajo |
| `ENVIADO` | **Resend aceptó su correo** y hay un identificador de Resend. No afirma que haya llegado al buzón | Por la respuesta exitosa del lote o por cualquier evento asociado de su correo, lo que llegue primero | Ninguno; es final, y el identificador no cambia |
| `FALLIDO` | Su correo no salió | Su lote quedó `RECHAZADO` por los datos de la petición, con el motivo (§3.5), o `VENCIDO`, con «no se envió a tiempo». Un incidente operativo nunca lo produce | `ENVIADO`, solo si llega un evento asociado que lo contradiga |
| `SIN_CONFIRMAR` | No se sabe si salió | Su lote quedó `SIN_CONFIRMAR`; su lote ya era `ACEPTADO` cuando llegó un rechazo o un `409` de otro cuerpo; o su lote es `ACEPTADO` pero el día terminó sin que llegara su identificador | `ENVIADO`, si llega un evento asociado |

**`EventoCorreo`: lo que avisa Resend después.** Cada evento es una fila de solo inserción, y un evento repetido (mismo `svix-id`) no inserta otra.

*Asociación*, según §3.7:

| Asociación | Qué significa | Efecto |
|---|---|---|
| Asociado | Etiqueta, identificador y destinatario concuerdan con un registro | Concilia, cuenta para la entrega y puede excluir la dirección |
| Anómalo | Apunta a la alerta, pero algo no concuerda; lleva uno de los códigos de §3.7 | Se guarda sin registro. No concilia, no cuenta para la entrega ni excluye nada |
| Ajeno | No es un correo de la alerta | No se guarda |

*Tipo de evento*, según el nombre que manda Resend:

| Evento | Qué significa |
|---|---|
| `email.sent` | Resend aceptó el correo y va a intentar entregarlo |
| `email.delivered` | El servidor de correo del destinatario aceptó el mensaje |
| `email.delivery_delayed` | Problema temporal; Resend sigue intentando |
| `email.bounced` | El servidor del destinatario rechazó el mensaje. El tipo de rebote lo dice la tabla siguiente |
| `email.complained` | Se entregó y el destinatario lo marcó como spam |
| `email.failed` | Resend no pudo enviarlo (cuota agotada, destinatario inválido, etc.), con el motivo en `data.failed.reason` |
| `email.suppressed` | Resend no lo envió porque la dirección está en su lista de supresión |

*Clasificación del rebote*, solo en los eventos de rebote. Sale de `data.bounce.type`, no del nombre del evento:

| Valor | Valor de Resend | Qué significa |
|---|---|---|
| `PERMANENTE` | `Permanent` (rebote duro) | La dirección no existe o no acepta correo. No se entregará nunca |
| `TRANSITORIO` | `Transient` o `Temporary` (rebote suave) | Por ejemplo, el buzón lleno. Todavía puede entregarse |
| `INDETERMINADO` | `Undetermined` o cualquier valor desconocido | Resend no lo pudo clasificar. Se trata como provisional |

**Estado de entrega: calculado, no guardado.** Se calcula con todos los eventos **asociados** al registro. Gana el de mayor precedencia, sin importar el orden en que llegaron:

| Precedencia | Estado de entrega | Lo produce | Cuándo se supera |
|---|---|---|---|
| 1 | Marcado como spam | `email.complained` | Nunca |
| 2 | No entregado | Rebote `PERMANENTE`, `email.failed` o `email.suppressed` | Solo por una queja. Prevalece sobre «entregado» aunque llegue después |
| 3 | Entregado | `email.delivered` | Por un rebote duro o una queja |
| 4 | Entrega demorada | Rebote `TRANSITORIO` o `INDETERMINADO`, o `email.delivery_delayed` | Por una entrega posterior |
| 5 | Aceptado por Resend | Ningún evento asociado todavía | Por cualquier evento asociado |

**Lo que ve el usuario en el apartado «Preferencias».** Un solo estado de su último aviso. La evidencia de Resend tiene prioridad sobre el estado del registro, así que nunca aparece «pendiente» junto a «entregado».

| Se muestra | Cuándo |
|---|---|
| «En proceso» | Registro `PENDIENTE` y sin eventos asociados |
| «Aceptado por Resend» | Registro `ENVIADO` y sin eventos asociados |
| «Entrega demorada» | Precedencia 4 |
| «Entregado» | Precedencia 3 |
| «No entregado» | Precedencia 2 |
| «Marcado como spam» | Precedencia 1 |
| «No se envió» | Registro `FALLIDO` y sin eventos asociados |
| «Sin confirmar» | Registro `SIN_CONFIRMAR` y sin eventos asociados |

Además del estado, el apartado «Preferencias» puede mostrar avisos que no son estados de un envío:

| Aviso | Cuándo |
|---|---|
| Dirección excluida | Su dirección actual tiene un rebote duro, una supresión o una queja asociados en el historial, sin importar qué cuenta los recibió. No se le reserva hasta que pase a una dirección no excluida |
| «Hoy no hubo artículos bajo mínimo» | El día ya se evaluó con `SIN_BAJO_MINIMO` y tiene la preferencia encendida |
| «Empieza mañana» | Tiene la preferencia encendida y su dirección no está excluida, pero el día ya se evaluó con `CON_ENVIO` o `SIN_DESTINATARIOS` sin incluirlo. Pasa, por ejemplo, si la encendió después de la evaluación |

## 4. Tablero de inicio

El tablero sustituye el inicio demostrativo actual (avance de fases y artículos de muestra). Lee en una sola instantánea y reutiliza las consultas de los listados y reportes, sin calcular cifras por su cuenta.

**Todos ven lo mismo.** Superadmin, Compras y Jefe ven las mismas tarjetas con las mismas cifras. Ninguna depende de un permiso de acción (capturar, confirmar, autorizar, retirar) ni de la facultad `puedeAutorizar`: cada tarjeta exige solo el permiso de **lectura** de la pantalla a la que remite, y los tres roles ya los tienen todos. El servidor sigue comprobando ese permiso; si un rol futuro no lo tuviera, su tarjeta no se consultaría ni aparecería.

| Tarjeta | Qué muestra | De dónde sale | Permiso |
|---|---|---|---|
| Bajo mínimo | N (§3.1) y los primeros 10 renglones, en el orden del reporte | La consulta del reporte de existencias con el filtro de bajo mínimo (`filasExistencias` y el conteo de artículos distintos) | `reportes:leer` |
| Préstamos abiertos | Número de préstamos abiertos y los más antiguos | `listarPrestamos(db, "abiertos", …)` | `devoluciones:leer` y `salidas:leer`, como el listado |
| Salidas por autorizar y por retirar | Número de salidas solicitadas y de autorizadas, y las más antiguas de cada una | `seccionDeBandeja(db, "SOLICITADA", …)` y `seccionDeBandeja(db, "AUTORIZADA", …)`, que no filtran por usuario | `salidas:leer` |
| Entradas en borrador | Número de borradores y los más recientes | `listarEntradas` con el filtro de estatus borrador | `entradas:leer` |
| Gasto del mes por estación | Las **5 estaciones de mayor gasto** del día 1 del mes a hoy | `gastoPorEstacion` y `totalGasto` con ese rango | `reportes:leer` |

- **Salidas.** El tablero no usa `bandejaDeSalidas`, porque esa función solo devuelve las secciones en que el usuario puede actuar: sin `puedeAutorizar` no saldría «por autorizar», y el Jefe, que no retira, nunca vería «por retirar». Las cifras enlazan al listado de salidas filtrado por estatus (`/salidas?estatus=solicitadas` y `?estatus=autorizadas`), que cualquiera con `salidas:leer` consulta completo. No enlazan a «Salidas pendientes», que sigue mostrando solo lo que cada usuario puede atender.
- Las 5 estaciones se ordenan por importe conocido sin IVA, de mayor a menor, con el número de estación como desempate. Las estaciones sin gasto en el mes no aparecen. Con piezas sin costo, el importe se rotula «valor conocido», como en el reporte.
- Cada tarjeta enlaza a su pantalla con los mismos filtros. La cifra del tablero y la de esa pantalla deben coincidir. En bajo mínimo, N se compara con los artículos distintos del reporte filtrado, no con su número de renglones.
- Una tarjeta en cero dice que no hay nada pendiente; no se presenta como error.

## 5. Alertas en pantalla

- La navegación muestra N (§3.1), el número de artículos distintos bajo mínimo, junto a «Existencias». La ve quien tiene `reportes:leer`, hoy los tres roles, y desaparece cuando N es cero.
- El indicador «Bajo mínimo», en reportes y tablero, combina color, ícono y texto: no depende solo del color.

## 6. Acabado de la interfaz

### 6.1 Celular y escritorio

- Todas las pantallas se pueden usar en un celular de 375 px de ancho y en escritorio, sin desplazamiento horizontal de la página.
- **Navegación.** En celular, la barra lateral fija se sustituye por una barra superior con menú desplegable.
- **Márgenes.** Los márgenes del contenido se ajustan al tamaño de la pantalla.
- **Tablas.** Pueden desplazarse dentro de su tarjeta o apilarse, según la pantalla.
- **Formularios.** Las rejillas de partidas, los selectores buscables y los botones de acción de los formularios de captura siguen siendo utilizables en celular.

### 6.2 Estados vacíos y errores

- Toda lista, reporte o tarjeta sin filas explica por qué está vacía y, si aplica, qué acción la llena. Para eso se usa `EstadoVacio`.
- Los mensajes distinguen entre:
  - Falta de permiso.
  - Sesión vencida.
  - Regla de negocio, con el motivo concreto.
  - Fallo del servidor o de la red.
- Hay página de error y página 404 propias, en español.

### 6.3 Confirmaciones

Toda acción irreversible pide confirmación con un diálogo propio, en lugar de `window.confirm`. Son irreversibles:
- Cancelar un borrador.
- Confirmar un movimiento.
- Autorizar, cancelar o retirar una salida.
- Revertir un movimiento.

El diálogo dice qué va a pasar y usa un botón con verbo explícito («Confirmar entrada», «Revertir»). Se maneja con teclado, Escape lo cierra sin actuar y, al cerrarse, el foco vuelve al botón que lo abrió. Revertir conserva el motivo obligatorio que ya pide.

## 7. Permisos, secretos y variables

- **Permiso nuevo:** `cuenta:editar`, para Superadmin, Compras y Jefe. Lo acompaña el cambio de la guarda de `Usuario` en la base (§2). El tablero no necesita permisos nuevos: sus tarjetas piden `reportes:leer`, `salidas:leer`, `devoluciones:leer` y `entradas:leer`, que los tres roles ya tienen.
- **Código de error nuevo:** `BG712`, para un cambio de `alertasCorreo` que no hace el propio usuario.
- **Variables de entorno nuevas:**
  - `RESEND_API_KEY`
  - `RESEND_WEBHOOK_SECRET`
  - `CORREO_REMITENTE`
  - `CRON_SECRET`
  - `URL_APLICACION`

  Van en `.env.example` con valores ficticios. `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` y `CRON_SECRET` son secretos: nunca llegan al navegador ni al repositorio.
- **Despliegue.**
  - Sevalla gana un proceso cron en la misma aplicación.
  - En Resend se da de alta el webhook hacia `<URL_APLICACION>/api/webhooks/resend` con los eventos de §3.7.
  - Ambos se documentarán en [versionado y despliegue](../05-versionado-y-despliegue.md) cuando existan.

## 8. Pruebas de aceptación y cierre

Las pruebas simulan Resend con un doble que respeta su idempotencia: misma llave y mismo cuerpo devuelven la respuesta original, otro cuerpo devuelve `409 invalid_idempotent_request` y una llave en curso devuelve `409 concurrent_idempotent_requests`. El doble puede demorarse y disparar eventos del webhook a mitad de la llamada.

1. La alerta incluye solo artículos activos en bodegas activas con existencia menor que el mínimo. Un mínimo cero, un artículo inactivo o una bodega inactiva no aparecen. La lista coincide con el reporte de existencias filtrado por bajo mínimo. Un artículo bajo mínimo en dos bodegas da dos renglones y suma uno a N.
2. Solo reciben la alerta los usuarios activos con la preferencia encendida. Un usuario nuevo, uno con la preferencia apagada o uno inactivo no la reciben.
3. Ejecutar el proceso dos veces seguidas el mismo día no envía un segundo correo a nadie ni agrega filas a `EvaluacionCorreos`, `LoteCorreos` ni `RegistroCorreos`.
4. **Dos corridas simultáneas:**
   - La segunda espera el candado, ve la evaluación de la primera y no evalúa. Pasa igual si la primera terminó `SIN_BAJO_MINIMO`: queda una sola evaluación.
   - Resend recibe una sola petición por llave.
   - Cada destinatario tiene una sola fila.
   - Un `409 concurrent_idempotent_requests` deja el lote `PENDIENTE`, nunca `FALLIDO`.
5. **Interrupción entre Resend y PostgreSQL.** Resend acepta el lote y la conciliación falla a propósito. Entonces:
   - El lote sigue `PENDIENTE`, con un intento.
   - Vencido el arriendo, la siguiente corrida manda la misma llave con el mismo cuerpo, byte por byte, y recibe los identificadores originales.
   - Cada integrante queda `ENVIADO`, sin correo duplicado.
   - Si en medio cambian las existencias o la preferencia de alguien, el cuerpo reenviado no cambia.
6. **Respuesta lenta.** Resend tarda más de 30 segundos. Entonces:
   - La llamada se aborta y ninguna transacción de la corrida queda abierta mientras espera (no hay sesión `idle in transaction`).
   - El lote sigue `PENDIENTE`.
   - Otra corrida antes de que venza el arriendo lo salta, y una posterior lo reintenta con la misma llave.
7. **`email.sent` antes de la respuesta de `batch.send`.** El doble dispara el webhook a mitad de la llamada y luego responde. Entonces:
   - El registro queda `ENVIADO` con el identificador del evento y el lote queda `ACEPTADO`.
   - La conciliación de la respuesta no cambia nada.
   - En el orden inverso el estado final es el mismo.
   - Repetir cualquiera de las dos conciliaciones no cambia nada.
   - Si la respuesta del lote trae un identificador distinto al que ya dejó el webhook, no se sobrescribe y deja una línea de error.
8. **`email.delivered` sin `email.sent`.** Un registro `PENDIENTE` queda `ENVIADO` con el identificador del evento, y el apartado «Preferencias» muestra «Entregado», nunca un envío pendiente.
9. **Fechas anteriores.** Al cerrarlas, sin llamar a Resend:
   - Un lote `PENDIENTE` sin intentos queda `VENCIDO`, con sus integrantes `FALLIDO`.
   - Un lote `PENDIENTE` con intentos queda `SIN_CONFIRMAR`.
   - Ninguno se reenvía.
   - Un evento posterior lleva a `ENVIADO` a un integrante `SIN_CONFIRMAR`.
10. **Día evaluado sin bajo mínimo.** A las 8:00 no hay artículos bajo mínimo:
    - Queda la evaluación `SIN_BAJO_MINIMO`, sin lotes ni registros, y no se llama a Resend.
    - A las 8:15 ya hay un artículo bajo mínimo, y la corrida no evalúa otra vez, no reserva y no llama a Resend.
    - El apartado «Preferencias» muestra «Hoy no hubo artículos bajo mínimo».
    - Al día siguiente, la corrida de las 8:00 sí evalúa y envía.
11. **Día evaluado sin destinatarios.** A las 8:00 hay artículos bajo mínimo pero nadie con la preferencia encendida:
    - Queda la evaluación `SIN_DESTINATARIOS`, sin lotes, y no se llama a Resend.
    - Un usuario enciende su preferencia a las 8:05, y la corrida de las 8:15 no evalúa otra vez ni le reserva.
    - El apartado «Preferencias» le muestra «Empieza mañana».
    - Al día siguiente queda incluido.
12. Un rechazo definitivo de un lote deja a sus integrantes `FALLIDO` con el motivo, no pisa un `ENVIADO` y no impide enviar los demás lotes.
13. La ruta programada responde 401 sin secreto o con uno incorrecto, y en ese caso no lee la base.
14. **Webhook:**
    - Con firma inválida responde 400 y no escribe nada.
    - Un evento repetido con el mismo `svix-id` deja una sola fila.
    - El evento de un correo ajeno a la alerta se descarta con 200.
15. **Correlación contradictoria.** Cada caso se prueba con un rebote duro y con un `email.delivered`:
    - `ETIQUETA_E_ID_DISCREPAN`: el `email_id` es del registro R1 y la etiqueta es de R2.
    - `DESTINATARIO_DISTINTO`: la etiqueta es de R1, pero `data.to` no trae la dirección de R1.
    - `ID_DISTINTO`: R1 ya tiene otro identificador.
    - `ETIQUETA_DESCONOCIDA`: la etiqueta no corresponde a ningún registro.
    - `SIN_ETIQUETA`: el `email_id` es de R1, pero el evento no trae etiqueta.

    En todos los casos:
    - El evento se guarda sin registro, con su código, y la ruta responde 200.
    - R1 y R2 no cambian de estado ni de entrega.
    - Ninguna dirección queda excluida.
    - El registro del servidor tiene una línea de error sin direcciones.
    - Repetir el evento con el mismo `svix-id` no agrega filas.
16. **Rebotes y entrega:**
    - Un rebote `Permanent` da «No entregado» y prevalece sobre «entregado» en cualquier orden.
    - Un rebote `Transient` seguido de `email.delivered` da «Entregado».
    - Un rebote `Undetermined`, o de tipo desconocido, da «Entrega demorada».
17. **Exclusión por dirección**, con el criterio de normalización de §3.7:
    - Al usuario A le rebota de forma permanente `x@…`, y luego A se da de baja. El usuario B se crea con la misma dirección escrita con otras mayúsculas o espacios, y queda excluido aunque nunca le haya rebotado.
    - El usuario C cambia su correo en Clerk a `x@…` y queda excluido desde la siguiente evaluación.
    - A, reactivado con otra dirección no excluida, vuelve a recibir. Ninguna preferencia cambia.
    - La supresión y la queja excluyen igual que el rebote duro.
    - Un rebote anómalo no excluye ninguna dirección.
18. **Privacidad de la preferencia en la aplicación:**
    - El apartado «Preferencias» devuelve solo los datos de la sesión.
    - La acción ignora cualquier identificador ajeno que reciba.
    - La administración de usuarios y su Excel no contienen la preferencia.
19. **Guarda de `Usuario` en la base**, con actor verificado:
    - Superadmin, Compras y Jefe cambian su propia `alertasCorreo`.
    - Un Superadmin que cambia la de otro usuario recibe `BG712`.
    - Un alta con la preferencia encendida recibe `BG712`.
    - El webhook de Clerk recibe `BG710` si la toca.
    - Un Jefe que cambia otra columna de su propia fila sigue recibiendo `BG708`.
    - El cambio propio deja en la bitácora un renglón con el propio usuario como actor y la fila completa en `antes` y `despues`.
20. **Orígenes y transiciones:**
    - Con `resumen-diario` y `resend-webhook` no se puede escribir fuera de sus tablas (`BG706`).
    - El usuario de la aplicación no puede borrar filas de `EvaluacionCorreos`, `LoteCorreos`, `RegistroCorreos` ni `EventoCorreo`, ni modificar las de `EvaluacionCorreos`.
    - No puede cambiar el contenido, la llave, los integrantes ni su posición.
    - No puede sacar de `ENVIADO` o de `ACEPTADO`, ni reemplazar un identificador de Resend.
21. Las cifras de cada tarjeta del tablero coinciden con su pantalla de origen. Superadmin, Compras, un Jefe con `puedeAutorizar` y uno sin ella ven las mismas cifras, también en salidas por autorizar y por retirar. El gasto devuelve como máximo 5 estaciones en el orden de §4, y una tarjeta sin permiso no se consulta.
22. La plantilla produce HTML y texto con el asunto «Stock bajo mínimo: 1 artículo» cuando N es 1 y «… N artículos» en otro caso. Agrupa por nombre de bodega sin mostrar su clave, muestra la clave del artículo, respeta el tope de 50 renglones y escapa el texto de los artículos.
23. Las pantallas de operación y reportes, y el apartado «Preferencias» del perfil, se usan sin desplazamiento horizontal de página a 375 px, y toda acción de §6.3 pide confirmación.

El cierre funcional exige las pruebas 1 a 22 contra PostgreSQL real, siguiendo el patrón de [`reportes.test.ts`](../../src/lib/reportes/reportes.test.ts), y la revisión 23 en el navegador. En Sevalla, el proceso cron se ejecuta a mano una vez antes de dejarlo programado, y el webhook de Resend se prueba con un evento de ejemplo desde su panel.

## 9. Decisiones tomadas al construir

### Entrega 1: migración y preferencia privada

- **Migración.** `20261107120000_correo_y_preferencia`, con el SQL a mano en [`997-correo-y-preferencia.sql`](../../prisma/sql/despues/997-correo-y-preferencia.sql). El índice de correo de `Usuario` se reemplaza creando primero el nuevo (`lower(btrim(correo))`) y después borrando el anterior, así que la unicidad nunca falta.
- **La preferencia se oculta por decisión, no por ser un dato sensible.** Mostrarla mañana en una pantalla o una exportación es un cambio aceptable. Lo que no cambia es que nadie modifique la de otro, por ninguna puerta: eso lo cierra `BG712` en la base.
- **Personas con sesión y tablas de correo.** Ninguna persona con sesión escribe en `EvaluacionCorreos`, `LoteCorreos`, `RegistroCorreos` ni `EventoCorreo`, tampoco el Superadmin: la escritura falla con `BG706`, aunque además declare un origen. Solo escriben sus dos orígenes de sistema y el dueño de la base.
- **Qué hace cada origen:**

  | Origen | Inserta en | Actualiza |
  |---|---|---|
  | `resumen-diario` | `EvaluacionCorreos`, `LoteCorreos`, `RegistroCorreos` | `LoteCorreos`, `RegistroCorreos` |
  | `resend-webhook` | `EventoCorreo` | `LoteCorreos`, `RegistroCorreos` |

- **Candado del día.** `candado_correos_del_dia(fecha)` es el `pg_advisory_xact_lock` del paso 1 de §3.4. Lo llama la reserva como primera sentencia, y las altas de lotes, registros y evaluaciones lo vuelven a tomar.
- **Integrantes cerrados.** Un lote o un registro no se inserta si su fecha ya tiene evaluación. La evaluación debe cuadrar con lo reservado: tantos lotes y destinatarios como filas existan para su fecha, y `lotes = ⌈destinatarios / 100⌉` en `CON_ENVIO`.
- **Restricciones en la base:**
  - `ENVIADO` si y solo si hay identificador de Resend.
  - La llave de un lote es `resumen-<fecha>-<numero>`.
  - `RegistroCorreos (loteId, fecha)` apunta a `LoteCorreos (id, fecha)`, así que la fecha del registro es la de su lote.
  - Lotes y registros nacen `PENDIENTE`. Los intentos suben de uno en uno, y solo un lote `PENDIENTE` o `ACEPTADO` se vuelve a intentar.
  - Un evento está asociado a un registro o lleva una anomalía, nunca las dos cosas ni ninguna.
- **Las transiciones obligan también al dueño.** El dueño puede escribir en las tablas, pero no saltarse las transiciones ni la inmutabilidad.
- **Tipo de evento como texto.** Un tipo nuevo de Resend se guarda en lugar de fallar, para que no provoque reintentos.
- **«Preferencias» en el perfil, sin pantalla propia.** La preferencia vive en un apartado del modal de perfil de Clerk (`UserButton.UserProfilePage`), junto a «Perfil» y «Seguridad», en lugar de una pantalla `/cuenta` con su enlace en la barra lateral. Sin dirección propia, el correo ya no enlaza a la preferencia (§3.3). El layout manda la lectura como promesa y el apartado la resuelve al abrirse; al guardar, la acción refresca el layout para que el modal muestre el valor nuevo.
- **El apartado en esta entrega:** muestra la preferencia, el correo y el horario. El último aviso, su estado y los avisos de §3.11 llegan en la entrega 2, junto con la reserva y el webhook que los producen.
- **La acción recibe una decisión explícita** (`activar` o `desactivar`), no una casilla, para que un campo ausente no apague la alerta. Solo lee ese campo, y el usuario sale siempre de la sesión.
- **Correo de los usuarios nuevos.** El §2 decía que el webhook de Clerk sincroniza usuarios nuevos, pero el webhook solo actualiza correo y bajas. Las altas las hacen el Superadmin y el arranque. No cambia nada, porque la preferencia nace apagada.
