/*
  Apartado «Preferencias» del perfil (contrato fase 9, §2 y prueba 18): lee y cambia solo la cuenta
  de la sesión, ignora cualquier identificador que llegue en el formulario, y
  la preferencia no aparece en la administración de usuarios.
*/

import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearCliente } from "../../../../prisma/comun";
import { URL_PRUEBAS } from "../../../../pruebas/base-de-pruebas";
import { formDataEspia } from "../../../../pruebas/formulario-espia";
import { sembrarEntorno, type Entorno } from "../../../../pruebas/semilla-entradas";
import { ESTADO_INICIAL } from "@/lib/cuenta/formulario";

const sesion = vi.hoisted(() => ({ userId: null as string | null, token: undefined as ((userId: string) => string | null) | undefined }));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@clerk/nextjs/server", async () => ({ auth: (await import("../../../../pruebas/clerk-simulado")).authSimulado(sesion) }));

process.env.DATABASE_URL = inject("urlEjecucionPruebas");
const { guardarPreferencia } = await import("./actions");
const { consultarMiCuenta } = await import("@/lib/cuenta/consultas");
const { consultar } = await import("@/lib/db");
const { listarUsuarios } = await import("@/lib/usuarios/repo");

const prisma = crearCliente(URL_PRUEBAS);
let e: Entorno;

beforeAll(async () => {
  e = await sembrarEntorno(prisma);
});
afterAll(() => prisma.$disconnect());

type Rol = keyof Entorno["usuarios"];
const como = async (rol: Rol | null) => {
  sesion.userId = rol ? (await prisma.usuario.findUniqueOrThrow({ where: { id: e.usuarios[rol].id } })).clerkUserId : null;
};
const alertasDe = async (rol: Rol) =>
  (await prisma.usuario.findUniqueOrThrow({ where: { id: e.usuarios[rol].id }, select: { alertasCorreo: true } })).alertasCorreo;

function formulario(campos: Record<string, string>) {
  const fd = new FormData();
  for (const [campo, valor] of Object.entries(campos)) fd.set(campo, valor);
  return formDataEspia(fd);
}

describe("guardarPreferencia", () => {
  it("sin sesión, la negativa llega antes de abrir el FormData", async () => {
    await como(null);
    const espia = formulario({ alertasCorreo: "activar" });
    await expect(guardarPreferencia(ESTADO_INICIAL, espia.formData)).resolves.toEqual({ mensaje: "No tienes acceso al sistema", tono: "error" });
    expect(espia.lecturas).toEqual([]);
  });

  it("cada rol activa y desactiva su propia alerta, con su actor en la bitácora", async () => {
    for (const rol of ["SUPERADMIN", "COMPRAS", "JEFE"] as const) {
      await como(rol);
      await expect(guardarPreferencia(ESTADO_INICIAL, formulario({ alertasCorreo: "activar" }).formData), rol).resolves.toEqual({
        mensaje: "Alerta activada",
        tono: "exito",
      });
      expect(await alertasDe(rol), rol).toBe(true);
      await expect(
        prisma.bitacora.findFirstOrThrow({ where: { tabla: "Usuario", registroId: e.usuarios[rol].id, accion: "ACTUALIZAR", despues: { path: ["alertasCorreo"], equals: true } } }),
        rol,
      ).resolves.toMatchObject({ usuarioId: e.usuarios[rol].id, verificacion: "liga" });

      await guardarPreferencia(ESTADO_INICIAL, formulario({ alertasCorreo: "desactivar" }).formData);
      expect(await alertasDe(rol), rol).toBe(false);
    }
  });

  it("ignora cualquier identificador ajeno: solo lee la decisión y cambia la cuenta de la sesión", async () => {
    const ajeno = await prisma.usuario.findUniqueOrThrow({ where: { id: e.usuarios.JEFE.id } });
    await como("COMPRAS");
    const espia = formulario({ alertasCorreo: "activar", id: ajeno.id, usuarioId: ajeno.id, clerkUserId: ajeno.clerkUserId });
    await expect(guardarPreferencia(ESTADO_INICIAL, espia.formData)).resolves.toMatchObject({ tono: "exito" });
    expect(espia.lecturas).toEqual(["get"]);
    expect(await alertasDe("COMPRAS")).toBe(true);
    expect(await alertasDe("JEFE")).toBe(false);
    await guardarPreferencia(ESTADO_INICIAL, formulario({ alertasCorreo: "desactivar" }).formData);
  });

  it("sin una decisión válida no cambia nada: que falte el campo no apaga la alerta", async () => {
    await como("JEFE");
    await guardarPreferencia(ESTADO_INICIAL, formulario({ alertasCorreo: "activar" }).formData);
    for (const campos of [{}, { alertasCorreo: "on" }, { alertasCorreo: "" }] as Record<string, string>[]) {
      await expect(guardarPreferencia(ESTADO_INICIAL, formulario(campos).formData), JSON.stringify(campos)).resolves.toEqual({
        mensaje: "Elige si activas o desactivas la alerta",
        tono: "error",
      });
    }
    expect(await alertasDe("JEFE")).toBe(true);
    await guardarPreferencia(ESTADO_INICIAL, formulario({ alertasCorreo: "desactivar" }).formData);
  });
});

describe("lectura de la preferencia", () => {
  it("«Preferencias» devuelve solo el correo y la preferencia de la sesión", async () => {
    for (const rol of ["SUPERADMIN", "COMPRAS", "JEFE"] as const) {
      await como(rol);
      const propio = await prisma.usuario.findUniqueOrThrow({ where: { id: e.usuarios[rol].id } });
      await expect(consultarMiCuenta(), rol).resolves.toStrictEqual({ correo: propio.correo, alertasCorreo: propio.alertasCorreo });
    }
  });

  it("la administración de usuarios no trae la preferencia", async () => {
    await como("SUPERADMIN");
    const usuarios = await consultar("usuarios:administrar", (db) => listarUsuarios(db));
    expect(usuarios.length).toBeGreaterThan(0);
    for (const u of usuarios) expect(Object.keys(u).sort()).toEqual(["activo", "clerkUserId", "correo", "id", "puedeAutorizar", "rol"]);
  });
});
