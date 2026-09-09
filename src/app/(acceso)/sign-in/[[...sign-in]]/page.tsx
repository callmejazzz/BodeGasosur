import { SignIn } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function PaginaIniciarSesion() {
  // A quien ya entró no se le enseña un formulario de acceso. Si además resulta
  // que no tiene fila en Usuario, la puerta de (sistema) lo manda a denegado.
  const { userId } = await auth();
  if (userId) redirect("/");

  return <SignIn />;
}
