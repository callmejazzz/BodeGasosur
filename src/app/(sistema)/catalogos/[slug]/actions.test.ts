/*
  La acción de catálogos, invocada directamente: sin sesión o sin permiso, la
  respuesta es la negativa y el FormData ni se abre; con permiso, se valida y
  se escribe con el actor verificado. Solo se sustituye lo que existe dentro
  de Next y la sesión de Clerk, que firma tokens de verdad.
*/

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearCliente } from "../../../../../prisma/comun";
import { URL_PRUEBAS } from "../../../../../pruebas/base-de-pruebas";
import { formDataEspia } from "../../../../../pruebas/formulario-espia";
import { sembrarEntorno, type Entorno } from "../../../../../pruebas/semilla-entradas";
import { ESTADO_INICIAL } from "@/lib/catalogos/formulario";

const sesion = vi.hoisted(() => ({ userId: null as string | null, token: undefined as ((userId: string) => string | null) | undefined }));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Error(`REDIRECT ${destino}`);
  },
}));
vi.mock("@clerk/nextjs/server", async () => ({ auth: (await import("../../../../../pruebas/clerk-simulado")).authSimulado(sesion) }));

process.env.DATABASE_URL = inject("urlEjecucionPruebas");
const { guardarCatalogo } = await import("./actions");

const prisma = crearCliente(URL_PRUEBAS);
let e: Entorno;

beforeAll(async () => {
  e = await sembrarEntorno(prisma);
});
afterAll(() => prisma.$disconnect());

const como = async (rol: keyof Entorno["usuarios"] | null) => {
  sesion.userId = rol ? (await prisma.usuario.findUniqueOrThrow({ where: { id: e.usuarios[rol].id } })).clerkUserId : null;
};

function bodega(nombre: string) {
  const fd = new FormData();
  fd.set("nombre", nombre);
  fd.set("ubicacion", "Calle 1");
  return formDataEspia(fd);
}

describe("guardarCatalogo", () => {
  it("sin sesión o sin permiso, la negativa llega antes de abrir el FormData", async () => {
    const casos = [
      { rol: null, slug: "bodegas", mensaje: "No tienes permiso para modificar bodegas." },
      { rol: "JEFE", slug: "bodegas", mensaje: "No tienes permiso para modificar bodegas." },
      { rol: "COMPRAS", slug: "empresas", mensaje: "No tienes permiso para modificar empresas." },
      { rol: null, slug: "no-existe", mensaje: "No tienes permiso para esta operación." },
    ] as const;
    for (const { rol, slug, mensaje } of casos) {
      await como(rol);
      const espia = bodega("");
      await expect(guardarCatalogo(slug, null, ESTADO_INICIAL, espia.formData), `${rol} ${slug}`).resolves.toEqual({ errores: {}, mensaje });
      expect(espia.lecturas, `${rol} ${slug}`).toEqual([]);
    }
  });

  it("con permiso, lo inválido vuelve marcado y con lo capturado", async () => {
    await como("COMPRAS");
    const espia = bodega("");
    await expect(guardarCatalogo("bodegas", null, ESTADO_INICIAL, espia.formData)).resolves.toMatchObject({
      errores: { nombre: expect.any(String) },
      mensaje: "Revisa los campos marcados.",
      valores: { nombre: "", ubicacion: "Calle 1" },
    });
    expect(espia.lecturas).not.toEqual([]);
  });

  it("con permiso, lo válido se escribe con el actor verificado", async () => {
    await como("COMPRAS");
    const nombre = `Bodega ${randomUUID().slice(0, 8)}`;
    await expect(guardarCatalogo("bodegas", null, ESTADO_INICIAL, bodega(nombre).formData)).rejects.toThrow("REDIRECT /catalogos/bodegas");
    const creada = await prisma.bodega.findFirstOrThrow({ where: { nombre } });
    await expect(prisma.bitacora.findFirstOrThrow({ where: { tabla: "Bodega", registroId: creada.id } })).resolves.toMatchObject({
      usuarioId: e.usuarios.COMPRAS.id,
      verificacion: "liga",
    });
  });

  it("un slug desconocido, con el permiso más estricto, es un catálogo desconocido", async () => {
    await como("SUPERADMIN");
    await expect(guardarCatalogo("no-existe", null, ESTADO_INICIAL, bodega("x").formData)).resolves.toEqual({
      errores: {},
      mensaje: "Catálogo desconocido.",
    });
  });
});
