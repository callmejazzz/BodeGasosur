# Fase 3 — Usuarios y permisos

| Campo | Referencia |
|---|---|
| Estado | Construida |
| Versión | `v0.3.0` |
| Commits | `7cc5203` — implementación; `fdb971f` — cierre de versión |
| Etiqueta Git | `v0.3.0` → `fdb971f` |

## Construido

- Autenticación e identidad delegadas a Clerk.
- Autorización leída desde PostgreSQL en cada petición.
- Tres roles: `SUPERADMIN`, `COMPRAS` y `JEFE`; `puedeAutorizar` como facultad separada.
- `consultar()` para lecturas protegidas y `accionProtegida()` para escrituras.
- Webhooks de Clerk atómicos e idempotentes.
- Pantalla de administración de usuarios, roles, acceso y facultad de autorizar.
- Navegación y catálogos adaptados al permiso del usuario.
- Registro de eventos de acceso y entregas de webhook.

## Archivos principales

| Archivo | Función |
|---|---|
| [`src/lib/db.ts`](../../src/lib/db.ts) | Sesión, lectura autorizada y escritura protegida |
| [`src/lib/permisos.ts`](../../src/lib/permisos.ts) | Matriz tipada de permisos |
| [`src/proxy.ts`](../../src/proxy.ts) | Enrutamiento protegido |
| [`src/app/(acceso)/`](<../../src/app/(acceso)/>) | Pantallas de acceso y acceso denegado |
| [`src/app/(sistema)/usuarios/`](<../../src/app/(sistema)/usuarios/>) | Administración de usuarios |
| [`src/app/api/webhooks/clerk/route.ts`](../../src/app/api/webhooks/clerk/route.ts) | Sincronización firmada con Clerk |
| [`src/lib/usuarios/`](../../src/lib/usuarios/) | Integración con Clerk y repositorio de usuarios |
| [`scripts/arranque-superadmin.ts`](../../scripts/arranque-superadmin.ts) | Alta idempotente del primer Superadmin |

## Cambio respecto al plan anterior

Se eligió Clerk en lugar de implementar contraseñas y sesiones propias. Los cinco roles
considerados durante el levantamiento se redujeron a tres; la autorización quedó como una
facultad editable, no como otro rol.

El cierre por invitación y una posible tabla `InvitacionAcceso` están diferidos para antes
de `v1.0.0`; no forman parte de la entrega construida de esta fase.
