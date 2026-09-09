import { SignUp } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function PaginaRegistro() {
  const { userId } = await auth();
  if (userId) redirect("/");

  return <SignUp />;
}
