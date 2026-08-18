# BodeGasosur — Levantamiento de requerimientos

Guía práctica para pasar de "controlar entradas y salidas" a un alcance definido.

## 1. Estrategia: la demo **es** la herramienta de levantamiento

Preguntar en abstracto ("¿qué necesitan que haga el sistema?") produce respuestas
vagas. Enseñar una pantalla concreta y equivocada produce correcciones precisas.
Por eso el orden recomendado es:

1. Construir la demo con los supuestos de §4 (ya están puestos en el modelo de datos).
2. Sentarse con el área de Compras y **capturar frente a ellos** un movimiento real de
   la semana pasada. Todo lo que no se pueda capturar es un requerimiento faltante.
3. Anotar cada "es que aquí también ponemos…" y "eso nunca pasa así".
4. Ajustar y repetir.

Dos actividades complementarias que valen más que cualquier junta:

- **Acompañar físicamente** una entrada de proveedor y una salida a estación. El proceso
  real casi nunca es el proceso descrito.
- **Pedir los documentos que hoy usan**: el Excel de control, el vale de salida en papel,
  el formato de requisición, un reporte que le manden a dirección. Esos formatos son el
  requerimiento, ya escrito por ellos.

## 2. Cuestionario para el área de Compras

Ordenado por bloques. Las marcadas con 🔴 son **bloqueantes**: cambian el modelo de
datos si se responden distinto a lo supuesto.

### Bloque A — Estructura física

1. ¿Cuántas bodegas hay y dónde están? ¿Todas manejan el mismo tipo de material?
2. 🔴 ¿Se mueve material **entre bodegas**, o cada bodega surte solo a sus estaciones?
3. ¿Cuántas estaciones surten y cómo las identifican internamente (número, clave, nombre)?
4. ¿Una estación tiene su propio almacencito, o lo que sale de bodega ya se considera consumido?
5. ¿Qué "áreas" existen como destino? (despacho, tienda/OXXO, mantenimiento, administración, limpieza…)

### Bloque B — Material

6. ¿Qué tipos de material manejan? (refacciones, consumibles, papelería, uniformes,
   aceites y lubricantes, equipo de seguridad…)
7. ¿Cuántos artículos distintos hay aproximadamente? ¿10, 200, 2000?
8. ¿Ya existe una clave o código de artículo, o hay que inventarla?
9. ¿En qué unidades se manejan? ¿Hay artículos que se compran en caja y se entregan en pieza? 🔴
10. ¿Hay material con **caducidad** o número de serie/lote que deba rastrearse? 🔴
11. ¿Hay material que se presta y regresa (herramienta, equipo), o todo es consumo? 🔴

### Bloque C — Proceso de entrada

12. ¿Cómo llega el material hoy? ¿Compra directa, orden de compra, transferencia de otra empresa del grupo?
13. 🔴 ¿Necesitan el ciclo completo requisición → orden de compra → recepción, o basta
    con registrar la entrada ya recibida?
14. ¿Se reciben **entregas parciales** de una misma compra? 🔴
15. ¿Quién físicamente recibe y quién captura? ¿Es la misma persona?
16. ¿Qué documento acompaña la entrada? (factura, remisión, nota) ¿Se guarda el número? ¿Se escanea?
17. ¿Qué pasa si llega material dañado o de menos? ¿Se registra y se devuelve?

### Bloque D — Proceso de salida

18. ¿Cómo pide material una estación? ¿Llamada, WhatsApp, formato, correo?
19. 🔴 ¿La salida requiere **autorización previa** de alguien, o el almacenista entrega y luego se registra?
20. ¿Quién puede autorizar? ¿Depende del monto o del tipo de material?
21. ¿Quién transporta? ¿Personal propio, un chofer designado, el mismo encargado de la estación,
    paquetería? ¿Se registra vehículo o placas?
22. ¿Se firma un vale de salida? ¿Necesitan **imprimir** ese comprobante desde el sistema? 🔴
23. ¿Se confirma la recepción del lado de la estación, o basta con la firma en papel? 🔴
24. ¿Hay devoluciones de estación a bodega? ¿Con qué frecuencia? 🔴

### Bloque E — Costos y dinero

25. 🔴 ¿El costo unitario que necesitan es el de la factura, o un costo promedio del almacén?
26. ¿Contabilidad exige un método específico (PEPS, promedio ponderado)?
27. ¿Se maneja IVA en el costo, o el costo es sin impuestos?
28. ¿Se compra alguna vez en otra moneda? 🔴
29. ¿Compras necesita ver el **valor total** del inventario por bodega, o solo cantidades?
30. ¿Se necesita comparar gasto contra un presupuesto por estación o por área? 🔴

### Bloque F — Control y conteo

31. ¿Hacen inventario físico? ¿Cada cuánto? ¿Cómo registran las diferencias hoy?
32. ¿Manejan stock mínimo / punto de reorden? ¿Quién decide esos números?
33. ¿Quieren alertas cuando algo baje del mínimo? ¿Por pantalla, correo, WhatsApp?
34. 🔴 ¿Puede el sistema **impedir** una salida si no hay existencia, o debe permitirla y
    solo advertir? (En la práctica muchos almacenes tienen faltantes de captura y un bloqueo
    duro frena la operación.)

### Bloque G — Reportes y consumidores de información

35. ¿Qué reportes entregan hoy y a quién? ¿Con qué periodicidad?
36. ¿Necesitan exportar a Excel? 🔴 (Casi siempre sí — conviene planearlo desde el inicio.)
37. ¿Dirección o contabilidad necesitan acceso, o solo Compras y almacén?
38. ¿Hay un sistema contable o ERP con el que esto deba conectarse algún día? 🔴

### Bloque H — Usuarios y operación diaria

39. ¿Cuántas personas usarían el sistema? ¿En cuántos lugares distintos?
40. ¿Desde dónde lo usarían? ¿Computadora de escritorio, celular en la bodega? 🔴
41. ¿Hay internet estable en todas las bodegas? ¿Se necesita que funcione sin conexión? 🔴
42. ¿Qué tan hábiles son con computadora? Esto define cuánto se puede pedir en una pantalla.
43. ¿Existe información histórica que haya que **migrar** (el Excel actual)? 🔴

### Bloque I — Éxito

44. Si el sistema funciona perfecto, ¿qué problema concreto desaparece?
45. ¿Qué es lo que hoy más les duele: no saber qué hay, no saber quién se lo llevó, no
    saber cuánto se gastó, o el tiempo que toma capturar?
46. ¿Qué NO debe hacer el sistema? (Poner límites evita crecimiento sin control.)

## 3. Artefactos a solicitar

Pide estos documentos antes de la siguiente reunión; valen más que dos horas de junta:

- [ ] El archivo Excel (o cuaderno) de control actual, con datos reales
- [ ] Un vale de salida lleno y firmado
- [ ] Una factura o remisión de entrada típica
- [ ] El formato de requisición de las estaciones, si existe
- [ ] Un reporte que hoy entreguen a dirección
- [ ] Listado de estaciones con sus claves
- [ ] Listado de artículos, aunque esté incompleto
- [ ] Organigrama del área o lista de quién autoriza qué

## 4. Supuestos vigentes de la demo

Estos son los supuestos ya implementados en el modelo de datos. **Cada uno es una
pregunta disfrazada de decisión**: si Compras lo contradice, se ajusta.

| # | Supuesto | Riesgo si es falso |
|---|---|---|
| S1 | Hay varias bodegas y sí se traspasa material entre ellas | Bajo — sobra funcionalidad, no falta |
| S2 | El costo se maneja por promedio ponderado móvil | **Alto** — PEPS exige capas de costo por lote |
| S3 | No hay lotes ni caducidades | **Alto** — agregar lotes toca todo el kardex |
| S4 | La autorización se registra como dato, no se valida por permisos | Bajo — el campo ya existe |
| S5 | No se permite existencia negativa | Medio — puede frenar la operación real |
| S6 | La salida se registra completa en un solo paso (sin confirmación de la estación) | Medio — un flujo de dos pasos agrega estados |
| S7 | Un artículo tiene una sola unidad de medida | Medio — las conversiones caja↔pieza son un módulo aparte |
| S8 | No hay órdenes de compra; la entrada solo referencia una factura o remisión | Medio — el ciclo de compra es un módulo arriba del actual |
| S9 | Todo es en pesos mexicanos, sin manejo de impuestos en el costo | Bajo |
| S10 | Uso desde computadora, con internet | Medio — el uso en celular en bodega cambia el diseño de las capturas |

## 5. Cómo documentar lo que vaya saliendo

Una plantilla corta por requerimiento, suficiente para no perder el hilo y para poder
priorizar después:

```markdown
### RF-012 — Imprimir vale de salida

**Origen:** Reunión con Compras, 20/ago/2026 — Lic. <nombre>
**Como** almacenista **quiero** imprimir el vale al confirmar una salida
**para** recabar la firma de quien recibe en la estación.

**Criterios de aceptación**
- [ ] El vale muestra folio, fecha, estación, área, partidas con cantidad y unidad
- [ ] Incluye espacios de firma para entrega, transporte y recepción
- [ ] Se puede reimprimir desde el detalle del movimiento

**Prioridad:** Alta · **Supuesto que afecta:** S6 · **Estado:** Confirmado
```
