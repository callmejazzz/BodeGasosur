# BodeGasosur — Análisis del inventario actual

Fuente: `MACRO STOCK CONTROL BODEGA.xlsx` (agosto 2026). Es el sistema que BodeGasosur
viene a reemplazar, y el origen de la migración.

## 1. Estructura del archivo

Tres hojas: `INV. MAGALLANES`, `INV. SERVI FER` y `CATALOGO PROVEDORES`.

Cada hoja de inventario tiene **tres bloques lado a lado**, a partir de la fila 9:

| Columnas | Bloque | Campos |
|---|---|---|
| A–E | **PRODUCTO** (existencia) | Código, Artículo, Entradas, Salidas, Stock |
| G–J | **ENTRADAS** | Código, Artículo, Fecha, Cantidad |
| L–S | **SALIDAS** | Código, Artículo, Fecha, Cantidad, Estación, Quién se lo lleva, **Solicitó** (rotulada *Diagnóstico*), Autorizó |

| | Magallanes | Servi Fer |
|---|---|---|
| Artículos en existencia | 133 | 92 |
| Movimientos de entrada | 147 | 93 |
| Movimientos de salida | 126 | 11 |
| Rango de fechas | 3 mar – 29 ago 2026 | 29 may – 9 ago 2026 |

En ambas hojas `ENTRADAS − SALIDAS = STOCK` cuadra en el 100 % de los renglones. La
aritmética del archivo es correcta; los problemas son de identidad de los datos, no de
cuentas.

## 2. El problema crítico: los códigos chocan entre bodegas

**Los 41 códigos que aparecen en las dos hojas designan artículos diferentes en cada una.**
Ninguno coincide.

| Código | En Magallanes | En Servi Fer |
|---|---|---|
| BM0093 | Válvula Skinner recta de 2 hilos 24V | Tramos cortos de 1" |
| BM0094 | Trompa de cochino codo de descarga | Tramos cortos de 3/4 de 30 cm |
| BM0095 | Medidores de Bennet RU gasolina/diésel | Tramos cortos de 3/4 de 15 cm |
| BM0096 | Medidores de alto flujo Bennet diésel | Tapas grises con conexión glandular Morrison |

La causa es simple: cada bodega numeró su lista por separado. Magallanes usa BM0001–BM0133
y Servi Fer BM0093–BM0184; en el traslape, el mismo código significa dos cosas.

El reverso también ocurre: *"Tramos cortos de 1""* es **BM0004** en Magallanes y **BM0093**
en Servi Fer. El mismo artículo, dos códigos.

**Consecuencia:** el código actual no puede migrarse como clave de artículo. En el modelo
nuevo el artículo es único y su existencia se lleva por bodega, así que hay que **volver a
numerar** y conservar el código viejo como referencia (`claveAnterior`) para que Compras
pueda rastrear sus registros históricos.

Son **225 renglones** de artículo entre las dos hojas y **224 descripciones distintas**:
en la práctica, casi todo el catálogo es específico de una bodega. Solo un artículo está
duplicado de verdad. Esto hay que revisarlo a mano con Compras — descripciones como
*"TRAMOS CORTOS DE 3/4 DE 30 CM"* y *"TRAMOS CORTOS DE 3/4 DE 15 CM"* son claramente
artículos distintos, pero otras pueden ser el mismo con redacción diferente.

## 3. Lo que el archivo no tiene

Ausencias que definen hasta dónde llega la migración:

| Falta | Impacto |
|---|---|
| **Costo unitario** | Los bloques de entrada solo traen fecha y cantidad. **No hay ningún dato de dinero en todo el archivo** |
| **Proveedor de cada entrada** | No se puede saber a quién se le compró qué |
| **Factura o remisión** | Sin referencia documental en el histórico |
| **Área destino** | Las salidas registran estación, no área. Las tres áreas de **A4** no tienen respaldo histórico |
| **Unidad de medida** | No hay columna. Todo parece manejarse por pieza |
| **Moneda y tipo de cambio** | No aplica: no hay costos |

Esto tiene una consecuencia directa y hay que decirla claro: **el inventario migra con
cantidades, sin valor**. El costo promedio, el valor del inventario y el gasto por estación
empiezan a construirse desde la primera entrada capturada en el sistema nuevo. No hay forma
de reconstruirlos hacia atrás con este archivo.

**Decisión tomada:** no se capturan los 225 costos a mano. El valor del inventario se
construye con las compras nuevas: cada artículo adquiere costo la primera vez que se
registra una entrada suya. Hasta entonces figura sin valuar, y así se le explicará a
Compras.

Lo mismo aplica al proveedor, el área destino y la moneda de las entradas históricas:
reconstruirlos sería trabajo manual de semanas. Las facturas y remisiones de ese periodo
existen impresas o digitales en las computadoras de Compras, fuera del archivo — quedan
como respaldo documental, no como dato del sistema.

## 4. Destinos que no están en el catálogo de estaciones

De 30 destinos usados en las salidas, 17 coinciden con el catálogo y **13 no**:

| Destino | Salidas | Interpretación probable |
|---|---|---|
| PORBA | 10 | ¿Porba Acapulco o Porba México? Ambigüedad real |
| LLANO 1 | 8 | Empresa *Servicio Llano Largo*; podría ser El Quemado o Puerto Marquez |
| SERVI FER 2 / SERVI FER 1 / SERVI FER | 12 | Servi Fer opera tres estaciones; falta saber cuál |
| PLAYAS | 2 | Es *Las Playas* |
| ALCARAZ 3 | 1 | El catálogo solo tiene Alcaraz 1 y 2 |
| VACACIONAL, SAN MARCOS, RENA, MODELO, ALBORADA | 24 | **No corresponden a ninguna de las 32** |
| BODEGA DE MAGALLANES | 1 | No es una salida: es un **traspaso entre bodegas** |

**Resuelto:** `VACACIONAL`, `SAN MARCOS`, `ALBORADA` y similares son **alias de las mismas
estaciones**; el resto son estaciones que aún no están en `Estaciones.xlsx`. La ambigüedad
de `PORBA` y `SERVI FER` —qué estación exacta de esa empresa recibió el material— **no se
puede deducir del archivo**: solo se resuelve preguntando a Compras caso por caso.

**Decisión:** BodeGasosur usa **un solo alias por estación**, el de `Estaciones.xlsx`.
Los nombres del histórico se traducen a ese alias durante la migración, con Compras
resolviendo caso por caso. No se guardan sinónimos en la base de datos.

## 5. Las personas del histórico

### Quién autorizó

| Valor | Veces |
|---|---|
| OSCAR / OSCAR B. | 69 |
| DIANA | 37 |
| LIC HUGO / LIC. HUGO | 26 |
| CP. COSUMEL / CP COSUMEL / C.P. COSUMEL | 4 |
| ING. ANDRES | 1 |

**Confirma la respuesta a D3**: autorizan el Lic. Hugo y el área de Compras (Oscar y
Diana). Dos observaciones que conviene verificar:

- **C.P. Cosumel** sí conserva la facultad de autorizar; quedó fuera de la lista inicial
  por decisión del momento, no por falta de permiso. Es justamente el caso que obliga a
  que la lista sea editable desde el sistema.
- La **Lic. Andrea** de la lista de autorizadores y el **Ing. Andrés** del histórico son
  **dos personas distintas**. Entran por separado al catálogo.

### Quién se lo lleva

16 valores distintos: Oscar (64), Diana (18), Don Emigdio (10), Recep. Magallanes (7),
Don Nacho (6), Don Poncho, Nabor, Josué Nava, Pablo Nava, Juan Carlos…

Confirma **D4**: no hay transportistas asignados. También confirma la nota de la junta de
que en entrega y recepción no hay personas definidas — aquí aparecen empleados de Compras,
ingenieros, personal de estación y hasta un punto físico (*"Recep. Magallanes"*), que ni
siquiera es una persona.

### Quién solicitó — la columna rotulada *Diagnóstico*

*Gerente* (107), Don Poncho (9), Ing. Josué (11 entre sus variantes), Ing. Guillermo,
Ing. Nabor, Ing. Andrés.

**El rótulo engaña: esta columna registra a quien solicitó el material**, no un
diagnóstico técnico. Con esa lectura, el archivo cobra otro sentido: el Excel ya contiene
los tres papeles del flujo que se definió en la junta.

| Columna del Excel | Campo del modelo |
|---|---|
| *Diagnóstico* | `solicitadoPor` |
| *Autorizó* | `autorizadoPor` |
| *Quién se lo lleva* | `entregadoA` |

Que el 78 % de las solicitudes vengan del *gerente* confirma lo que describió Compras: la
estación pide, Compras autoriza y entrega. No hay nada de mantenimiento en el archivo, y
la decisión de dejar ese historial fuera de alcance no pierde ningún dato.

### Higiene de los datos

El mismo nombre aparece escrito de varias formas: `LIC HUGO` / `LIC. HUGO`,
`CP. COSUMEL` / `CP COSUMEL` / `C.P. COSUMEL`, `OSCAR` / `OSCAR B.`,
`JOSUE` / `ING. JOSUE` / `ING. JOSUE NAVA`. Nueve nombres reales se escriben de catorce
maneras. El catálogo de personas lo resuelve de raíz.

## 6. Catálogo de proveedores

137 renglones. Columnas: Nombre comercial, Razón social, RFC, Contacto, Teléfono, Correo,
Producto/Bien. Las columnas **G** (condiciones de pago) e **I** (observaciones) se
descartan por indicación de Compras.

Qué tan completo está:

| Campo | Vacíos |
|---|---|
| Nombre comercial y razón social | 0 de 137 |
| RFC | 5 |
| Correo | 37 |
| Producto/Bien | **117** |
| Contacto y teléfono | **115** |

Los tres últimos son demasiado escasos para tratarlos como obligatorios. `Producto/Bien`
tiene solo 20 valores capturados, entre ellos *Refacciones*, *Papelería*, *Luminaria*,
*Uniformes*, *Imprenta*, *Cerrajería*, *Paquetería*, *Extintores* y *Equipos de cómputo*:
sirve como semilla de un catálogo de giros, no como dato confiable.

### 33 de los 137 "proveedores" son empresas del propio grupo

Aparecen con el mismo RFC que las empresas operadoras de las estaciones: Combustibles
Gasosur (4 renglones), Servi Fer (3), Servicio Cayaco (3), Inmuebles Porba (2), Servi
Boulevard (2)…

No es un error: entre empresas del grupo se factura, y por eso están ahí. Pero confirma
que **razón social y RFC son un concepto compartido** entre estaciones y proveedores, y
justifica la tabla `Empresa` global de [06-estaciones.md](06-estaciones.md).

Además, **12 RFC están repetidos dentro de la propia hoja**, en parte porque se escriben
con y sin guiones (`MAS950425A11` frente a `MAS-950425-A11`). La normalización de §4 de
ese documento resuelve las dos cosas a la vez.

## 7. Plan de migración

1. **Empresas y estaciones** — desde `Estaciones.xlsx`, con el RFC normalizado. 22
   empresas, 32 estaciones. Directo.
2. **Proveedores** — 137 renglones. Los 33 del grupo se enlazan a la `Empresa` que ya
   existe; los 104 externos crean la suya. Contacto, teléfono y giro quedan opcionales.
3. **Artículos** — 225 renglones a revisar a mano con Compras para detectar duplicados
   entre bodegas. Se asigna clave nueva y se conserva la anterior por bodega.
4. **Personas** — unificar las catorce grafías en los nombres reales. Marcar quién puede
   autorizar.
5. **Existencia inicial** — un movimiento de tipo `AJUSTE` por bodega con el stock final
   de cada artículo, fechado al día del corte y con la observación *"saldo inicial
   migrado del Excel"*. **Sin costo**, por §3.
6. **Histórico de movimientos** — 240 entradas y 137 salidas. Migrarlo es opcional: no
   afecta la existencia, que ya entra por el paso 5. Vale la pena solo si Compras quiere
   consultar los meses anteriores dentro del sistema. **Requiere resolver antes los 13
   destinos de §4.**

**Recomendación:** hacer los pasos 1 a 5 y dejar el 6 para el final, como tarea
independiente. Así el sistema arranca con existencias correctas sin depender de que se
aclaren los destinos ambiguos, y el Excel queda como consulta del pasado hasta que se
decida si vale la pena traerlo.

## 8. Preguntas del archivo — respondidas

| # | Pregunta | Respuesta |
|---|---|---|
| 1 | ¿`VACACIONAL`, `SAN MARCOS`, `ALBORADA`…? | **Alias de estaciones existentes**, o estaciones que aún no están en `Estaciones.xlsx`. Se traducen al alias oficial durante la migración |
| 2 | ¿Existe `ALCARAZ 3`? | **Sí**, es una de las estaciones todavía no capturadas en el archivo |
| 3 | ¿A qué estación exacta se refieren `PORBA` y `SERVI FER`? | **No se puede deducir del archivo.** Nombran a la empresa, no a la estación. Se resuelve preguntando a Compras, salida por salida |
| 4 | ¿La C.P. Cosumel conserva la facultad de autorizar? | **Sí.** Es jefa y está facultada; quedó fuera de la lista inicial por decisión del momento. Es el caso que justifica que la lista sea editable |
| 5 | ¿La Lic. Andrea y el Ing. Andrés son la misma persona? | **No.** Son dos personas distintas y entran por separado al catálogo |
| 6 | ¿Capturar el costo de los 225 artículos? | **No.** Es trabajo manual de semanas. El valor se construye con las compras nuevas |
| 7 | ¿El campo *Diagnóstico* se descarta? | **No es un diagnóstico: es quién solicitó el material.** Se conserva como `solicitadoPor` |

### El catálogo de estaciones está incompleto por diseño

`Estaciones.xlsx` tiene 32 estaciones capturadas; el grupo opera alrededor de **40**,
y hay más empresas de las 22 registradas. **LA HERRADURA** es una de las que faltan.

No es un bloqueo: el catálogo se completa **desde el sistema**, con una pantalla de alta y
edición de estaciones. El archivo es la carga inicial, no la fuente permanente. Esa
pantalla pasa a ser un entregable de la fase de catálogos, no un extra.
