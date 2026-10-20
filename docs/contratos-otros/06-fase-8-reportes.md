# BodeGasosur — contrato de la fase 8: Reportes y exportación

**Estado:** fase 8 construida, documentada y publicada en `v0.8.0`. Los cinco reportes, la exportación a Excel de todas las tablas de consulta y sus pruebas contra PostgreSQL real están implementados; §6 registra las decisiones que este contrato dejaba abiertas. Complementa el [expediente de la fase](../entregables-fases/08-reportes.md), el [modelo de datos](../02-modelo-de-datos.md) y los contratos de [Entradas](02-fase-5-entradas.md), [Salidas](04-fase-6-salidas.md) y [movimientos de la fase 7](05-fase-7-traspasos-devoluciones-conteo.md).

## 1. Resultado y límites

Compras y Jefatura pueden consultar el reporte semanal, las existencias por bodega, el kardex, el gasto acumulado por estación y la frecuencia de consumo. Los reportes explican las cantidades con el libro de movimientos y separan el valor conocido de las piezas sin costo. Todas las tablas de consulta pueden descargarse en Excel con el mismo alcance, filtros y permisos que su pantalla.

No se crea un segundo libro, un cierre semanal almacenado ni una tarea que genere el reporte automáticamente. Una entrada capturada después con fecha operativa anterior cambia el histórico al volverlo a consultar; el reporte indica cuándo fue generado. Las alertas en pantalla y por correo pertenecen a la fase 9. También quedan fuera los costos estimados para capas sin valuación, la importación de movimientos históricos y las órdenes de compra.

## 2. Reglas comunes de lectura y dinero

- **Corte.** `Movimiento.fecha` es el día operativo en `America/Mexico_City`; `createdAt` y `confirmadoEn` son instantes de captura y confirmación, no el criterio del periodo. Cada consulta obtiene una instantánea consistente mediante `consultar()`. Una fecha de corte nunca incluye movimientos de días posteriores, aunque el reporte se genere hoy.
- **Hechos que afectan stock.** Se suman capas creadas (`CapaCosto.cantidadInicial`), se restan consumos (`ConsumoCapa.cantidad`) y se suman restituciones (`RestitucionCapa.cantidad`), cada hecho en la `fecha` del movimiento que lo produjo. La salida cuenta al quedar `RETIRADA`; pasar a `RECIBIDA` no la descuenta de nuevo. Borradores, solicitudes, autorizaciones, rechazos y cancelaciones sin retiro no afectan stock. Las reversas son asientos nuevos en su propia fecha; el original permanece en su fecha y no se borra del histórico.
- **Conciliación.** Por artículo y bodega, saldo inicial + altas − bajas = saldo final. Al día actual, el saldo final coincide con `Existencia.cantidad` y con `SUM(CapaCosto.cantidadRestante)`. Un traspaso resta en origen y suma en destino; al sumar bodegas su efecto neto es cero. Nunca se suman piezas de artículos con unidades distintas en una cifra global de inventario.
- **Valuación.** Los costos de `CapaCosto`, `ConsumoCapa` y `RestitucionCapa` están congelados en MXN por unidad base, con par sin IVA y con IVA. PostgreSQL calcula y redondea cada renglón a dos decimales antes de sumar, conforme a `importe_renglon()`; JavaScript solo presenta el resultado. El importe conocido y la cantidad sin costo se muestran por separado. `NULL` significa costo desconocido, nunca cero ni un importe total completo. La factura de una entrada en USD conserva su moneda original en el movimiento, pero la valuación comparable del inventario usa sus costos convertidos a MXN.
- **Catálogos históricos.** Un artículo, bodega o estación inactivos siguen apareciendo cuando tienen saldo o movimientos dentro del corte. Los filtros y enlaces conservan su clave o folio; la baja lógica no oculta historia.
- **Listas.** Los reportes muestran hasta 100 filas por página, total y orden estable con identificador como desempate. El servidor ejecuta filtros, agregación y paginación; no carga todo el libro en el navegador. La página solicitada fuera de rango se acota como en las listas existentes.

## 3. Reportes

### 3.1 Semanal del viernes

Se elige un viernes no posterior al día actual. La semana va del **sábado anterior al viernes elegido, ambos incluidos**. Por omisión se abre el viernes más reciente; si se consulta durante ese viernes, el reporte es provisional hasta terminar el día y puede cambiar después por capturas o reversas. Se genera a demanda, sin envío ni archivo automático.

Una fila representa **artículo y bodega**; se muestran filas con movimiento en la semana o saldo inicial o final distinto de cero. Columnas: semana y fecha de corte; clave, descripción y unidad del artículo; clave y nombre de bodega; saldo inicial; entradas por compra; salidas retiradas hacia estaciones; traspasos recibidos y enviados; devoluciones recibidas; ajustes positivos y negativos; reversas que suman y restan; saldo final; valor conocido final sin IVA y con IVA; y piezas finales sin costo. Las reversas se identifican como tales por `cancelaAId`, aunque su tipo técnico sea `AJUSTE` o `TRASPASO`; no se presentan como una compra o un traspaso ordinario. La devolución sin salida vinculada suma stock en su bodega, con costo desconocido, pero no reduce gasto de una estación.

Filtros: viernes de corte obligatorio, bodega opcional y búsqueda de artículo por clave o descripción. Orden inicial por bodega y clave de artículo. Los totales de cantidades se calculan **por artículo y unidad**; no se ofrece un total de piezas mezcladas. Los importes conocidos pueden totalizarse con aviso visible si hay piezas sin costo.

### 3.2 Existencias por bodega y mínimo

Es una consulta **actual**, no una fotografía histórica: usa `Existencia` y las capas restantes en la misma instantánea. Una fila representa artículo y bodega, incluso cuando su cantidad es cero si un artículo activo corresponde al filtro de bajo mínimo. Columnas: bodega; artículo y unidad; existencia; mínimo configurado en `Articulo.stockMinimo`; diferencia respecto del mínimo; indicador «Bajo mínimo» cuando el artículo y la bodega están activos y `cantidad < stockMinimo`; valor conocido sin IVA y con IVA; piezas sin costo. El mínimo actual del artículo se compara **en cada bodega**, porque el modelo no tiene mínimos distintos por bodega. Mínimo cero y existencia cero no son «Bajo mínimo».

Filtros: bodega, búsqueda de artículo y solo bajo mínimo. Por omisión se muestran artículos con existencia o bajo mínimo; un artículo activo con cero y mínimo cero se encuentra mediante búsqueda. Los artículos o bodegas inactivos con existencia siguen visibles como históricos, sin indicador de bajo mínimo. Orden inicial: primero los que están bajo mínimo, luego bodega y clave de artículo. El indicador pertenece al reporte; las alertas activas quedan para la fase 9.

### 3.3 Kardex por artículo

Exige un artículo y permite elegir una bodega o ver todas. Una fila representa el efecto de una partida en **una bodega**; un traspaso presenta una salida y una entrada en sus bodegas respectivas. Columnas: fecha operativa; folio y tipo visible, incluida la indicación de reversa y el folio original; bodega; origen o destino cuando aplique; referencia o motivo; cantidad que entra; cantidad que sale; saldo corrido **de esa bodega**; importe conocido del movimiento sin IVA y con IVA; y piezas del movimiento sin costo. Una partida que toca varias capas suma importes ya redondeados por fragmento y conserva el acceso al movimiento que explica su costo. `RECIBIDA` no genera otra fila de stock.

Filtros: artículo obligatorio, bodega opcional y rango inclusivo de fechas operativas; por omisión, el mes en curso hasta hoy. El saldo inicial se calcula con los hechos anteriores al primer día, aunque no se muestren esas filas. Orden por `fecha`, luego instante de confirmación, movimiento y partida para que el saldo corrido sea reproducible. Al mostrar todas las bodegas no se inventa un saldo único por fila: cada bodega conserva su propio saldo. Las reversas permanecen visibles en su fecha y se enlazan con el original.

### 3.4 Gasto acumulado por estación

Mide material **consumido neto**, no todo lo enviado. Incluye salidas `RETIRADA` o `RECIBIDA` que no son préstamos. Descuenta las devoluciones confirmadas vinculadas a esas salidas; una devolución sin vínculo no se atribuye como descuento. Excluye préstamos y sus devoluciones. La reversa de una salida o de una devolución compensa el efecto de esta en la fecha de la reversa, sin reescribir el movimiento anterior. El gasto se obtiene de los costos congelados en los consumos o en las capas devueltas/restituidas, no del importe de una factura de compra.

Una fila representa estación y, si se solicita el detalle, artículo. Columnas: número y alias de estación; periodo; cantidad retirada; cantidad devuelta; cantidad neta **por artículo y unidad en el detalle**; gasto conocido neto sin IVA y con IVA; y piezas netas sin costo. La vista agrupada por estación suma importes, pero no mezcla cantidades de artículos distintos. Si hay piezas sin costo, el importe se rotula «valor conocido», no «gasto total». Filtros: rango inclusivo de fechas, estación y artículo opcionales; por omisión, del 1 de enero del año en curso hasta hoy. Orden inicial por número de estación y clave de artículo en el detalle. El periodo usa la fecha del hecho que suma o compensa gasto: un retorno posterior reduce el acumulado cuando ocurre y puede producir un importe neto negativo en un periodo corto.

### 3.5 Frecuencia de consumo

Una ocurrencia es una **partida de artículo de una salida efectivamente retirada**, sin contar solicitudes que no llegaron al retiro. Una salida con ese artículo cuenta una vez aunque haya consumido varias capas; recibirla después no vuelve a contarla. Una salida revertida deja de contar al recalcular el reporte. Una devolución no crea una ocurrencia negativa: la frecuencia mide retiros, mientras el gasto mide consumo neto. Los préstamos retirados se incluyen como retiros y se identifican por separado para no confundirlos con gasto.

Una fila representa artículo en el periodo; columnas: clave, descripción y unidad; número de retiros, número de esos retiros marcados como préstamo, unidades retiradas y fecha del último retiro. Filtros: rango inclusivo de fechas, estación, bodega de salida y búsqueda de artículo; por omisión, del 1 de enero del año en curso hasta hoy. Orden inicial por número de retiros descendente y clave de artículo. El rango se aplica a la fecha operativa del retiro y la reversión excluye la salida original si ya está revertida al generar el reporte.

## 4. Permisos y exportación a Excel

Los tres roles actuales, `SUPERADMIN`, `COMPRAS` y `JEFE`, pueden leer los cinco reportes mediante `reportes:leer`. Este permiso es solo de lectura y no depende de `puedeAutorizar`. El servidor lo exige para pantalla y descarga; ocultar un enlace no sustituye la comprobación. La exportación de una lista ya existente exige **el mismo permiso que la lista**: por ejemplo, `usuarios:administrar` para usuarios, `catalogos:leer` para catálogos y los permisos de lectura correspondientes para movimientos. La lista de préstamos conserva sus dos comprobaciones de lectura. Las secciones de identidades de Clerk solo se exportan para quien puede administrar usuarios y sin añadir datos que no muestre esa pantalla.

Toda tabla de consulta de los reportes y de los listados actuales —catálogos, usuarios, entradas, salidas, pendientes, traspasos, devoluciones, ajustes, préstamos y hojas de conteo— tiene descarga `.xlsx`. También la tienen las tablas de consulta paginadas en detalles; las rejillas de captura editables no son reportes. Cada hoja o archivo indica título, filtros normalizados y momento de generación. Exporta todas las filas que coinciden con los filtros de esa tabla, en el mismo orden y con las mismas columnas de datos que se ven en pantalla, sin limitarse a la página actual ni incluir botones de acción. Cuando una pantalla contiene varias tablas, cada una conserva su alcance y puede tener su propia hoja. Las fechas son fechas de Excel y los importes y cantidades son celdas numéricas, no texto formateado como número. Los costos desconocidos quedan vacíos y su conteo va en columna aparte.

La descarga vuelve a validar sesión, permiso y filtros en el servidor, consulta una instantánea consistente y no acepta nombres de tabla ni SQL del navegador. Escapa las cadenas que Excel interpretaría como fórmulas (`=`, `+`, `-`, `@` y controles iniciales) sin alterar los valores numéricos reales. La exportación procesa filas por lotes para el volumen esperado; si el servidor no puede producir el archivo completo, devuelve un error visible y pide acotar filtros. **Nunca entrega un archivo truncado como si estuviera completo.** No se cachean respuestas privadas entre usuarios.

## 5. Pruebas de aceptación y cierre

1. Para varias bodegas y artículos, el semanal cumple saldo inicial + altas − bajas = saldo final, y el cierre de hoy coincide con `Existencia` y capas restantes. El traspaso cambia las bodegas correctas sin crear stock global.
2. Una salida solicitada o autorizada no aparece como consumo; retirada sí; recibida no duplica su efecto. Reversas, ajustes y devoluciones aparecen una sola vez en sus fechas y con su signo correcto.
3. Un costo `NULL` produce cantidad sin valuar y no se convierte en cero. Con capas de distinto costo e IVA, los importes de reportes coinciden con una consulta SQL de control que redondea por renglón, sin cálculos monetarios paralelos en JavaScript.
4. El gasto excluye préstamos, descuenta devoluciones vinculadas no prestadas y deja fuera las no vinculadas. La frecuencia cuenta partidas retiradas y no las capas PEPS ni las solicitudes canceladas.
5. Kardex y semanal históricos se recalculan al ingresar después una entrada con fecha operativa anterior. Los saldos del kardex respetan bodega, fecha y desempate estable; una reversa posterior no borra el asiento original.
6. Mínimo cero, artículo sin existencia, artículo o bodega inactivos con historia y filtros vacíos o sin coincidencias se presentan sin cifras engañosas.
7. Para cada tabla, Excel y pantalla devuelven las mismas filas filtradas y ordenadas; Excel incluye también las páginas posteriores a la primera. Una sesión sin permiso no obtiene archivo, y texto semejante a una fórmula no se ejecuta al abrirlo.

El cierre funcional exige estas pruebas contra PostgreSQL real y consultas SQL independientes. La base de Supabase consultada al redactar este contrato aún no tiene artículos ni movimientos, de modo que esas comprobaciones de importes requieren datos de prueba controlados. Sevalla tiene desplegado `main` en la aplicación de prueba.

Las siete pruebas viven en [`reportes.test.ts`](../../src/lib/reportes/reportes.test.ts), con un escenario fechado a mano y SQL de control que redondea con `round()`, y en [`route.test.ts`](../../src/app/exportar/[tabla]/route.test.ts), que descarga cada tabla por la ruta real con la sesión de Clerk simulada.

## 6. Decisiones tomadas al construir

### Sin migración

Los reportes son consultas de solo lectura sobre las tablas de la fase 7: no hay vistas, funciones ni columnas nuevas, y la fase no agrega migración. Los hechos que mueven existencia —capas, consumos y restituciones de movimientos con efecto, en la fecha de su movimiento— se escriben una vez en [`hechos.ts`](../../src/lib/reportes/hechos.ts) y los reutilizan el semanal y el kardex. El gasto y la frecuencia leen sus propios hechos porque miden otra cosa: consumo neto por estación y retiros.

### Semana, corte y periodo

Se leen del encabezado del reporte, en pantalla y en cada hoja de Excel, y no se repiten en cada fila. La semana se pide con el viernes de corte; otro día se lleva al viernes anterior, y uno futuro, al viernes más reciente. Cada fila del semanal enlaza al kardex de su artículo en esa semana y bodega.

### Valor de un saldo histórico

El valor final del semanal es, por capa, lo que quedaba al corte (creada − consumida + restituida hasta ese día) por su costo, redondeado por capa con `importe_renglon()`. Al corte de hoy coincide con `CapaCosto.cantidadRestante`. Como ningún movimiento confirmado lleva fecha futura y solo las entradas admiten fecha anterior, una capa nunca queda negativa en una fecha pasada.

Sin piezas, el valor es $0.00, no «desconocido»: un saldo o una existencia en cero, o un gasto que su reversa compensó por completo, valen cero aunque lo que hubo no tuviera costo. El importe vacío queda solo para piezas cuyo costo no se conoce.

### Columnas que el contrato dejaba abiertas

- **Kardex:** el importe lleva signo: negativo cuando la pieza sale. Las piezas sin costo van sin signo. La reversa de una entrada, salida o devolución, que es un `AJUSTE`, muestra como origen o destino el proveedor o la estación del original. Al lado del kardex, un resumen por bodega con saldo inicial, entradas, salidas y saldo final; también se descarga.
- **Gasto:** las reversas se netean en su columna: la de una salida resta de «retirado» y la de una devolución, de «devuelto». La vista por estación muestra cuántos artículos tuvo y cuántos con piezas sin costo, nunca una suma de piezas de artículos distintos.
- **Existencias:** «diferencia» es existencia menos mínimo, también con mínimo cero.
- **Totales por artículo del semanal:** solo sin filtro de bodega; con una bodega, cada fila ya es su artículo.
- **Catálogo dado de baja:** el texto de la celda lo dice («(dada de baja)»), en pantalla y en Excel, en lugar de una insignia que no viajaría al archivo.

### Exportación

- **Una ruta, una lista cerrada.** `GET /exportar/<tabla>` resuelve `<tabla>` contra un registro fijo de 21 descargas ([`descargas.ts`](../../src/lib/exportar/descargas.ts)); lo demás responde 404, también `constructor` o `__proto__`. Cada descarga exige el permiso de su pantalla y lee por `consultarParaDescarga()`: la misma transacción `REPEATABLE READ READ ONLY` de `consultar()` con 60 s para leer por lotes. Sin sesión responde 401 y sin permiso 403, en JSON y con `Cache-Control: private, no-store`.
- **Un libro por pantalla.** Cada tabla de la pantalla es una hoja: el semanal trae la de filas y la de totales por artículo; el detalle de una salida, partidas, capas consumidas, lo devuelto y sus devoluciones. Cada hoja empieza con título, momento de generación y filtros normalizados, y la tabla lleva encabezado fijo y autofiltro.
- **Mismas filas, mismo orden.** La descarga llama a la misma función de la lista, con lotes de 1,000 en lugar de páginas de 100, dentro de una sola instantánea, y comprueba que leyó tantas filas como dijo el total. Las columnas de los reportes se definen una vez ([`columnas.ts`](../../src/lib/reportes/columnas.ts)) y las leen la pantalla y el Excel. En las listas que ya existían, una celda que en pantalla junta varios datos —artículo y descripción, cantidad y presentación, total y moneda— se separa en sus columnas, y las insignias de estatus van como texto.
- **Tope.** Hasta 20,000 filas por tabla. Si una tabla pide más, la descarga responde 413 con el número de filas y pide acotar los filtros. La respuesta empieza hasta que el libro comprimido está completo, así que nunca sale a medias.
- **Solicitudes repetidas y abuso** ([`generaciones.ts`](../../src/lib/exportar/generaciones.ts)). Las cuentas viven en memoria; la aplicación corre en una sola instancia, y si se escala cada instancia llevaría la suya.
  - **Cada intento con sesión cuenta**, también los que terminan en 429: treinta por minuto por sesión de Clerk. Se cuentan antes de revisar cupos y de leer la base, así que un intento de más se rechaza sin consultar al usuario. El `Retry-After` dice cuándo sale de la ventana el más antiguo de los últimos treinta; insistir lo recorre. De cada sesión se guardan solo esos treinta. Sin sesión, la ruta responde 401 sin contar: frenar ese tráfico toca antes de la aplicación, con un límite por IP en Sevalla, y queda pendiente.
  - **Descargas activas: dos por usuario.** Una descarga está activa desde que se admite hasta que el servidor envía su último byte o la respuesta se corta; esperar un libro en curso también cuenta. La tercera responde 429 con `Retry-After: 5`. Cada descarga activa tiene un plazo de 2 minutos: al vencer, el cupo vuelve y la respuesta se corta con error, para que no siga enviándose sin cupo; si vence mientras espera el libro, deja de esperarlo y responde 503.
  - **El mismo pedido se comparte.** Usuario, tabla y filtros normalizados (sin orden, vacíos ni página): si ese libro ya se está armando, la petición lo espera y no arma otro.
  - **El libro compartido tiene su propio plazo: 90 s**, más que los 60 s que se acota la lectura de PostgreSQL y menos que los 2 minutos de cada descarga. Al vencer deja de compartirse, quienes lo esperan responden 503 y el trabajo recibe una señal para detenerse. La compresión del XLSX la atiende entre partes. La espera a Clerk del libro de usuarios también, y además se corta a los 15 s por página; como el SDK de Clerk no acepta señal, se deja de esperar y su petición se cierra sola después. El lugar en el cupo del proceso vuelve cuando el trabajo termina de verdad; si sigue vivo 30 s después de su plazo, se registra como error.
  - **Cupo del proceso: tres libros armándose a la vez**, de cualquier usuario y contando los que ya vencieron pero no se han detenido; el siguiente responde 429 con `Retry-After: 5`, y un usuario, con dos, no puede ocuparlo todo. Con la escritura por partes la memoria ya no es lo que limita: más libros a la vez no se arman más rápido con una CPU (tres tardan 1.5 s y seis 2.9 s), solo ocupan más. La instancia tiene 1 GB.
  - **Libros nuevos por usuario:** diez en el último minuto; pasado eso, 429 con `Retry-After` hasta que salga el más antiguo. Esperar un libro en curso no cuenta como libro nuevo.
  - **Entrega sin copias.** El libro se envía por flujo en trozos de 64 KiB que son vistas del mismo `Buffer`, así que las respuestas que lo comparten no lo copian. Con una copia por respuesta, 40 respuestas de un libro de 2 MiB sumaban 175 MiB de RSS; por flujo, nada.
  - En el navegador, un `useRef` corta el segundo clic antes de que el render deshabilite el botón.
- **Registro.** Cada descarga deja una línea `[exportar]` en el registro del servidor, junto a los errores, cuando el servidor envía el último byte: tabla, archivo, usuario y rol, filas, bytes, milisegundos de generación y si compartió libro. «Entregado» quiere decir enviado por el servidor, no recibido por el navegador. Si se corta, dice cuántos bytes alcanzó a tomar quien leía; si lo corta el plazo, queda como aviso «cortado por plazo». No guarda filtros ni filas. Los rechazos por límite quedan como aviso con el usuario —o la sesión de Clerk, si se rechazan antes de consultarlo—, uno por motivo por minuto, y los errores llevan el usuario. Un valor que no se puede escribir en Excel (`ValorNoExportable`) se registra con su formato de celda, sin el valor.
- **Escritura por partes.** Cada hoja se escribe en partes de 100 filas y cada archivo del ZIP se comprime con un deflate incremental, cediendo el event loop entre partes; el CRC y los tamaños se calculan al vuelo y el encabezado local se escribe al terminar cada archivo. Solo el libro comprimido queda en memoria (1.1 MiB para 20,000 filas), nunca el XML completo. Las filas sí se leen completas, en lotes, dentro de la instantánea. Medido con un libro sintético de 20,000 filas y 12 columnas, en un proceso nuevo por caso:

  | Libros a la vez | Pico de RSS antes → ahora | Bloqueo máximo del event loop antes → ahora |
  |---|---|---|
  | 1 | +295 → +96 MiB | 546 → 20 ms |
  | 3 | +454 → +216 MiB | 1,142 → 24 ms |

  Las filas solas son unos 10 MiB por libro; el resto del pico es texto que el recolector todavía no reclama. El XML que se escribe es idéntico byte por byte al de la escritura anterior.
- **El archivo.** Se escribe sin dependencias ([`xlsx.ts`](../../src/lib/exportar/xlsx.ts)): un ZIP con el XML mínimo de Office Open XML. Las fechas son fechas de Excel; las horas, la del reloj de la Ciudad de México. Los números se escriben con el texto que dio PostgreSQL, sin pasar por punto flotante, y un costo desconocido es una celda vacía.
- **Fórmulas.** Las cadenas van en línea (`inlineStr`), que Excel nunca evalúa, y las que empiezan con `=`, `+`, `-`, `@` o un control llevan además `quotePrefix`, la marca que Excel usa para el texto escrito con apóstrofo: se ve igual y no se evalúa ni al editarla. Los números negativos son números, no texto.
- **Detalles.** El botón aparece donde hay una tabla de consulta; un borrador en edición o una hoja de conteo que se captura son rejillas de captura y no lo muestran.
- **Usuarios.** «Con acceso» sale de la base y «Sin acceso» de Clerk, fuera de la transacción, con correo y nombre: lo que muestra la pantalla, sin el identificador de Clerk.
