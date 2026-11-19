import "server-only";
import { consultar } from "@/lib/db";
import type { MiCuenta } from "./formulario";
import { leerMiCuenta } from "./repo";

export function consultarMiCuenta(): Promise<MiCuenta> {
  return consultar("cuenta:editar", (db, usuario) => leerMiCuenta(db, usuario.id));
}
