/*
  Las dos formas de llegar a una base de Supabase —directo o por Supavisor—
  tienen que reconocerse como la misma base, y los scripts del dueño no pueden
  pasar por Supavisor, que descarta TimeZone=UTC.
*/
import { describe, expect, it } from "vitest";
import { crearClienteDelDueno } from "../prisma/comun";
import { asegurarUsuarioDeEjecucion, leer } from "./usuario-ejecucion";

const DIRECTO = "postgresql://postgres:x@db.abcdefghijkl.supabase.co:5432/postgres";
const POOLER = "postgresql://bodegasosur_app.abcdefghijkl:y@aws-0-us-east-1.pooler.supabase.com:5432/postgres";

describe("URL de Supabase", () => {
  it("directo y por Supavisor son el mismo servidor, y el usuario es el rol sin el proyecto", () => {
    expect(leer("D", DIRECTO)).toMatchObject({ usuario: "postgres", servidor: "supabase:abcdefghijkl", base: "postgres" });
    expect(leer("P", POOLER)).toMatchObject({ usuario: "bodegasosur_app", servidor: "supabase:abcdefghijkl", base: "postgres" });
  });

  it("dos proyectos distintos no son la misma base", async () => {
    const otro = POOLER.replace("abcdefghijkl", "zyxwvutsrqpo");
    await expect(asegurarUsuarioDeEjecucion(DIRECTO, otro)).rejects.toThrow(/mismo servidor/);
  });

  it("los scripts del dueño se niegan a pasar por Supavisor", () => {
    const antes = process.env.DATABASE_URL_MIGRACIONES;
    process.env.DATABASE_URL_MIGRACIONES = POOLER.replace("bodegasosur_app", "postgres");
    try {
      expect(() => crearClienteDelDueno()).toThrow(/Supavisor/);
    } finally {
      process.env.DATABASE_URL_MIGRACIONES = antes;
    }
  });
});
