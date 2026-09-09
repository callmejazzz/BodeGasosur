import Link from "next/link";
import { FilaAcceso } from "@/components/usuarios/fila-acceso";
import { Card, CardHeader, EncabezadoPagina, EstadoVacio } from "@/components/ui/superficies";
import { consultar, sesionActual, SinPermiso } from "@/lib/db";
import { listarIdentidades, POR_PAGINA } from "@/lib/usuarios/clerk";
import { listarUsuarios, type UsuarioAdministrable } from "@/lib/usuarios/repo";
import { guardarAcceso } from "./actions";

// Quién tiene acceso cambia por fuera de esta pantalla —webhooks, otro
// Superadmin— así que no se cachea.
export const dynamic = "force-dynamic";

export default async function PaginaUsuarios({ searchParams }: PageProps<"/usuarios">) {
  const { p } = await searchParams;
  const pagina = Math.max(1, Number(typeof p === "string" ? p : "1") || 1);

  // 1. Autorizar y leer PostgreSQL. Si el rol no administra usuarios, esto
  //    lanza y se responde con una pantalla, no con un error del servidor.
  let usuarios: UsuarioAdministrable[];
  try {
    usuarios = await consultar("usuarios:administrar", (db) => listarUsuarios(db));
  } catch (error) {
    if (!(error instanceof SinPermiso)) throw error;
    return (
      <>
        <EncabezadoPagina titulo="Usuarios" />
        <Card>
          <EstadoVacio
            titulo="No tienes permiso para administrar usuarios"
            descripcion="Solo el Superadmin concede accesos y edita la facultad de autorizar."
          />
        </Card>
      </>
    );
  }

  // 2. Clerk, ya fuera de la transacción: es una petición HTTP y no puede
  //    retener una conexión de PostgreSQL esperando a la red.
  const { identidades, total } = await listarIdentidades(pagina);

  const sesion = await sesionActual();
  const miId = sesion.estado === "activa" ? sesion.usuario.id : null;

  const conAcceso = new Set(usuarios.map((u) => u.clerkUserId));
  const sinAcceso = identidades.filter((i) => !conAcceso.has(i.clerkUserId));
  const ultimaPagina = Math.max(1, Math.ceil(total / POR_PAGINA));

  return (
    <>
      <EncabezadoPagina
        titulo="Usuarios"
        descripcion="Clerk dice quién eres; esta pantalla dice qué puedes hacer. La facultad de autorizar es una bandera del usuario, independiente del rol: un Jefe puede tenerla y alguien de Compras puede no tenerla."
      />

      <Card className="mb-6">
        <CardHeader
          titulo="Con acceso"
          descripcion="Los cambios surten efecto en la siguiente petición: el rol y la bandera se leen de la base en cada una."
        />
        {usuarios.length === 0 ? (
          <EstadoVacio titulo="Todavía nadie tiene acceso" />
        ) : (
          usuarios.map((u) => (
            <FilaAcceso
              key={u.clerkUserId}
              modo="con-acceso"
              clerkUserId={u.clerkUserId}
              correo={u.correo}
              nombre={null}
              rol={u.rol}
              puedeAutorizar={u.puedeAutorizar}
              activo={u.activo}
              esTuCuenta={u.id === miId}
              accion={guardarAcceso}
            />
          ))
        )}
      </Card>

      <Card>
        <CardHeader
          titulo="Sin acceso"
          descripcion="Usuarios registrados en Clerk, sin acceso al sistema."
        />
        {sinAcceso.length === 0 ? (
          <EstadoVacio
            titulo="Ninguna identidad pendiente en esta página"
            descripcion={total > POR_PAGINA ? "Hay más identidades en otras páginas." : undefined}
          />
        ) : (
          sinAcceso.map((i) => (
            <FilaAcceso
              key={i.clerkUserId}
              modo="sin-acceso"
              clerkUserId={i.clerkUserId}
              correo={i.correo}
              nombre={i.nombre}
              accion={guardarAcceso}
            />
          ))
        )}

        {ultimaPagina > 1 && (
          <div className="flex items-center justify-between border-t border-border px-5 py-3 text-sm">
            <span className="text-muted">
              Página {pagina} de {ultimaPagina} · {total} identidades en Clerk
            </span>
            <span className="flex gap-3">
              {pagina > 1 && (
                <Link href={`/usuarios?p=${pagina - 1}`} className="text-primary hover:underline">
                  Anterior
                </Link>
              )}
              {pagina < ultimaPagina && (
                <Link href={`/usuarios?p=${pagina + 1}`} className="text-primary hover:underline">
                  Siguiente
                </Link>
              )}
            </span>
          </div>
        )}
      </Card>
    </>
  );
}
