import { FilaAcceso } from "@/components/usuarios/fila-acceso";
import { Paginacion } from "@/components/ui/paginacion";
import { Card, CardHeader, EncabezadoPagina, EstadoVacio } from "@/components/ui/superficies";
import { consultar, sesionActual, SinPermiso } from "@/lib/db";
import { acotarPagina, leerPagina, paginar, parametrosDePaginas } from "@/lib/paginacion";
import { listarIdentidades } from "@/lib/usuarios/clerk";
import { listarUsuarios, type UsuarioAdministrable } from "@/lib/usuarios/repo";
import { guardarAcceso } from "./actions";

// Quién tiene acceso cambia por fuera de esta pantalla —webhooks, otro
// Superadmin— así que no se cachea.
export const dynamic = "force-dynamic";

export default async function PaginaUsuarios({ searchParams }: PageProps<"/usuarios">) {
  // Cada lista pagina por su cuenta: ?conAcceso=2&sinAcceso=3
  const params = await searchParams;

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
  //    retener una conexión de PostgreSQL esperando a la red. El total llega
  //    con la respuesta: una página que ya no existe se pide otra vez, la última.
  const pedida = leerPagina(params.sinAcceso);
  let clerk = await listarIdentidades(pedida);
  const paginaClerk = acotarPagina(pedida, clerk.total);
  if (paginaClerk.actual !== pedida) clerk = await listarIdentidades(paginaClerk.actual);
  const { identidades } = clerk;

  const sesion = await sesionActual();
  const miId = sesion.estado === "activa" ? sesion.usuario.id : null;

  const conAcceso = new Set(usuarios.map((u) => u.clerkUserId));
  const sinAcceso = identidades.filter((i) => !conAcceso.has(i.clerkUserId));
  const accesos = paginar(usuarios, leerPagina(params.conAcceso));
  // Los enlaces de una lista conservan la página de la otra.
  const paginas = parametrosDePaginas({ conAcceso: accesos.pagina, sinAcceso: paginaClerk });

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
          accesos.filas.map((u) => (
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
        <Paginacion pagina={accesos.pagina} ruta="/usuarios" parametros={paginas} parametro="conAcceso" sustantivo="usuarios con acceso" />
      </Card>

      <Card>
        <CardHeader
          titulo="Sin acceso"
          descripcion="Usuarios registrados en Clerk, sin acceso al sistema."
        />
        {sinAcceso.length === 0 ? (
          <EstadoVacio
            titulo="Ninguna identidad pendiente en esta página"
            descripcion={paginaClerk.ultima > 1 ? "Hay más identidades en otras páginas." : undefined}
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

        <Paginacion pagina={paginaClerk} ruta="/usuarios" parametros={paginas} parametro="sinAcceso" sustantivo="identidades en Clerk" />
      </Card>
    </>
  );
}
