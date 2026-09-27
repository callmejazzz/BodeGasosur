/*
  La administración de accesos, invocada directamente: sin sesión o sin
  permiso, la negativa llega antes de abrir el FormData y antes de preguntarle
  nada a Clerk; con permiso, el acceso se guarda con el actor verificado.
*/

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearCliente } from "../../../../prisma/comun";
import { URL_PRUEBAS } from "../../../../pruebas/base-de-pruebas";
import { formDataEspia } from "../../../../pruebas/formulario-espia";
import { sembrarEntorno, type Entorno } from "../../../../pruebas/semilla-entradas";
import { ESTADO_INICIAL } from "@/lib/usuarios/formulario";

const sesion = vi.hoisted(() => ({ userId: null as string | null, token: undefined as ((userId: string) => string | null) | undefined }));
const clerk = vi.hoisted(() => ({ obtenerIdentidad: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@clerk/nextjs/server", async () => ({ auth: (await import("../../../../pruebas/clerk-simulado")).authSimulado(sesion) }));
vi.mock("@/lib/usuarios/clerk", () => clerk);

process.env.DATABASE_URL = inject("urlEjecucionPruebas");
const { guardarAcceso } = await import("./actions");

const prisma = crearCliente(URL_PRUEBAS);
let e: Entorno;

beforeAll(async () => {
  e = await sembrarEntorno(prisma);
});
afterAll(() => prisma.$disconnect());

const como = async (rol: keyof Entorno["usuarios"] | null) => {
  sesion.userId = rol ? (await prisma.usuario.findUniqueOrThrow({ where: { id: e.usuarios[rol].id } })).clerkUserId : null;
};

function acceso(clerkUserId: string, rol: string) {
  const fd = new FormData();
  fd.set("clerkUserId", clerkUserId);
  fd.set("rol", rol);
  fd.set("activo", "on");
  return formDataEspia(fd);
}

describe("guardarAcceso", () => {
  it("sin sesión o sin permiso, ni se abre el FormData ni se consulta a Clerk", async () => {
    const casos = [
      { rol: null, mensaje: "No tienes acceso al sistema." },
      { rol: "COMPRAS", mensaje: "No tienes permiso para administrar usuarios." },
      { rol: "JEFE", mensaje: "No tienes permiso para administrar usuarios." },
    ] as const;
    for (const { rol, mensaje } of casos) {
      await como(rol);
      clerk.obtenerIdentidad.mockClear();
      const espia = acceso("user_x", "SUPERADMIN");
      await expect(guardarAcceso(ESTADO_INICIAL, espia.formData), String(rol)).resolves.toEqual({ mensaje, tono: "error" });
      expect(espia.lecturas, String(rol)).toEqual([]);
      expect(clerk.obtenerIdentidad, String(rol)).not.toHaveBeenCalled();
    }
  });

  it("un superadmin guarda el acceso: Clerk se consulta una vez y la bitácora lleva su liga", async () => {
    const objetivo = await prisma.usuario.create({
      data: { clerkUserId: `user_acc_${randomUUID().slice(0, 8)}`, correo: `acc.${randomUUID().slice(0, 8)}@prueba.test`, rol: "COMPRAS" },
    });
    clerk.obtenerIdentidad.mockReset();
    clerk.obtenerIdentidad.mockResolvedValue({ clerkUserId: objetivo.clerkUserId, correo: objetivo.correo, nombre: null });
    await como("SUPERADMIN");
    await expect(guardarAcceso(ESTADO_INICIAL, acceso(objetivo.clerkUserId, "JEFE").formData)).resolves.toEqual({
      mensaje: "Acceso guardado.",
      tono: "exito",
    });
    expect(clerk.obtenerIdentidad).toHaveBeenCalledTimes(1);
    await expect(prisma.usuario.findUniqueOrThrow({ where: { id: objetivo.id } })).resolves.toMatchObject({ rol: "JEFE" });
    await expect(
      prisma.bitacora.findFirstOrThrow({ where: { tabla: "Usuario", registroId: objetivo.id, accion: "ACTUALIZAR" } }),
    ).resolves.toMatchObject({ usuarioId: e.usuarios.SUPERADMIN.id, verificacion: "liga" });
  });
});
