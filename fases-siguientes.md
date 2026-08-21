# BodeGasosur — Fases siguientes

Orden de trabajo a partir del levantamiento cerrado con Compras. Reemplaza el plan
original de [`docs/04-plan-demo.md`](docs/04-plan-demo.md), que se conserva como
referencia de cómo se llegó hasta aquí.

**Ya construido:** fases 0 y 1 de aquel plan — cimientos, modelo de datos inicial y los
ocho catálogos con datos sembrados.

---

## Fase 2 — Cimientos corregidos

Todo lo que el levantamiento invalidó del esquema actual. Va primero porque cada fase
posterior escribe sobre estas tablas.

- Migrar las llaves primarias a **UUIDv7** nativo (`@default(uuid(7)) @db.Uuid`)
- Rutas por **clave de negocio**: `/estaciones/ES05588`, no por id
- Crear el esquema `catalogo_gasosur` con `Empresa` y `Estacion`
- `Estacion`: `numero`, `alias`, `telefono`, `movil`, `correo`. El RFC se va a `Empresa`
- `Articulo`: agregar `piezasPorCaja` y `claveAnterior`
- `Movimiento`: eliminar `transportista` y `vehiculo`; renombrar `recibidoPor` a
  `entregadoA` y permitir texto libre
- `MovimientoPartida`: agregar `numeroSerie` como texto opcional
- Las tres áreas fijas: administración, mantenimiento y despacho

**Criterio de aceptación:** el esquema refleja lo acordado y los catálogos existentes
siguen funcionando.

## Fase 3 — Usuarios y permisos

Se adelanta respecto al plan original. Bloquea la fase de salidas: no se puede impedir una
salida sin autorización si el sistema no sabe quién está capturando.

### Los cinco roles

| Rol | Empresas y Estaciones | Resto de las tablas | Movimientos |
|---|---|---|---|
| **Superadmin** | CRUD completo | CRUD completo | Todo |
| **Admin** | **Solo lectura** | CRUD completo | Todo |
| **Compras** | Lectura | Captura y edita catálogos operativos | Registra entradas, salidas y traspasos |
| **Jefe** | Lectura | Lectura | Consulta |
| **Gerente** | Lectura | Lectura | Solicita material para su estación |

Además, transversal a los roles: la bandera **puede autorizar**, editable desde la pantalla
de usuarios.

**Por qué la bandera y no una lista en el código:** autorizan el Lic. Hugo, la Lic. Andrea
y el área de Compras, y la C.P. Cosumel también está facultada aunque quedó fuera de la
lista inicial. La lista cambia; el código no debería. La facultad de autorizar es
independiente del rol — un Jefe puede tenerla y un Admin puede no tenerla.

### Por qué Empresas y Estaciones son distintas

Son el único caso donde el Admin no puede escribir, y no es un capricho: viven en el
esquema **global del grupo**, que otros proyectos de Gasosur van a leer. Un cambio ahí sale
de BodeGasosur y afecta sistemas que no controlamos. Restringir la escritura al Superadmin
es lo que hace seguro compartir el catálogo.

### Pantalla por tabla para el Superadmin

El Superadmin necesita una pantalla de CRUD por cada tabla de la base de datos. **Esto ya
está resuelto:** los catálogos de la fase 1 se declaran en
[`src/lib/catalogos/definiciones.ts`](src/lib/catalogos/definiciones.ts) y de esa
descripción salen las columnas, el formulario y la validación. Agregar una tabla al panel
del Superadmin es una entrada de configuración, no una pantalla nueva.

**Criterio de aceptación:** dar y quitar la facultad de autorizar sin tocar el código ni la
base de datos, y que un Admin no pueda modificar una estación.

## Fase 4 — Migración de catálogos

- 22 empresas y 32 estaciones desde `Estaciones.xlsx`, con el RFC normalizado sin guiones
- **Pantalla de alta y edición de estaciones** — el catálogo llega incompleto: el grupo
  opera alrededor de **40 estaciones** y hay más empresas de las 22 capturadas
- 137 proveedores; los 33 que son empresas del grupo se enlazan a la `Empresa` existente
- 225 artículos **renumerados**, conservando la clave anterior por bodega
- Personas, unificando las catorce grafías de nueve nombres reales
- Existencia inicial como movimiento de `AJUSTE` por bodega, **sin costo**

**Por qué renumerar:** los 41 códigos que aparecen en las dos bodegas designan artículos
distintos en cada una. El código actual no puede migrarse como clave.

**Criterio de aceptación:** el sistema arranca con las existencias reales de ambas bodegas
y Compras puede rastrear sus registros viejos por la clave anterior.

## Fase 5 — Entradas

Nacen completas: agregar dinero después obligaría a recalcular todo lo capturado.

- Proveedor, factura o remisión, bodega destino, quién recibe
- **Moneda (MXN/USD), tipo de cambio e IVA**
- Capas de costo por entrada, consumidas por **PEPS**
- Captura en caja o pieza, convirtiendo a la unidad base
- Entregas parciales de una misma compra

**Depende de:** confirmar con Compras que PEPS es aceptable.

**Criterio de aceptación:** una entrada en dólares queda valuada en pesos al tipo de cambio
del día y no cambia después.

## Fase 6 — Salidas

El flujo completo, no la captura directa.

- Estados: `SOLICITADA → AUTORIZADA → ENTREGADA → RECIBIDA`, con `RECHAZADA` y `CANCELADA`
- Solicita el gerente, autoriza quien tenga la facultad, Compras entrega
- Estación y área destino; `entregadoA` como texto libre
- **Bloquear la salida sin existencia** y sin autorización
- Bandeja de entregas pendientes de confirmar recepción

**Criterio de aceptación:** el sistema impide una salida no autorizada aunque la pida un
gerente. Es el requisito #1 de Compras.

## Fase 7 — Traspasos, devoluciones y conteo

- Traspaso entre Magallanes y Servi Fer en una sola operación
- Devolución de estación a bodega
- Préstamo con retorno, que queda abierto hasta que el material vuelve
- Inventario físico: hoja de conteo imprimible y captura de diferencias
- Cancelación con asiento inverso y verificación de existencias

## Fase 8 — Reportes

- **Reporte de los viernes** para el Lic. Hugo: entradas, salidas y stock final
- Existencias por bodega con alerta de mínimos
- Kardex por artículo
- **Gasto acumulado por estación**
- **Frecuencia de consumo por pieza** — es lo que usan para fijar el stock mínimo
- Exportación a Excel en todos los listados

## Fase 9 — Acabado

- Tablero de inicio
- Alertas de stock mínimo: primero por pantalla y correo; WhatsApp después
- Diseño responsivo verificado en celular (**H2**)
- Estados vacíos y confirmaciones antes de acciones irreversibles

---

## Tarea aparte — Histórico de movimientos

**240 entradas y 137 salidas** del Excel. No afecta las existencias, que ya entran por la
fase 4, así que puede hacerse en cualquier momento o no hacerse.

Bloqueada por una sola cosa: en el histórico, `PORBA` y `SERVI FER` nombran a la empresa,
no a la estación, y solo Compras puede decir a cuál de sus dos o tres estaciones fue cada
salida. Los demás alias —`VACACIONAL`, `SAN MARCOS`, `ALBORADA`— se traducen igual, caso
por caso.

Migra sin costo, sin proveedor, sin área y sin moneda: el Excel no los tiene.

---

## Diferido

| Tema | Cuándo |
|---|---|
| Requisición → orden de compra → recepción | Cuando Compras lo pida; Diana lo quiere *"poco a poco"* |
| Integración con AuditorFiscalWeb | Sin acuerdo entre Diana y Oscar; no hay prisa |
| Alertas por WhatsApp | Después de que funcionen por pantalla y correo |
| Despliegue en servidor y respaldos | Cuando el sistema entre en uso real |
| Adjuntar factura escaneada | Cuando haya dónde almacenar archivos |

## Fuera de alcance

**Historial de mantenimiento.** No se registra dónde se instaló cada pieza ni quién
diagnosticó la falla. BodeGasosur lleva control de inventario y nada más.
