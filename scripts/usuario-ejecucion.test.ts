/*
  Las dos formas de llegar a una base de Supabase —directo o por Supavisor—
  tienen que reconocerse como la misma base, y los scripts del dueño no pueden
  pasar por Supavisor, que descarta TimeZone=UTC. La contraseña de la
  aplicación no viaja a la base: solo su verificador SCRAM.
*/
import { createHash, createHmac, randomBytes } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { URL_PRUEBAS } from "../pruebas/base-de-pruebas";
import { crearClienteDelDueno } from "../prisma/comun";
import { asegurarUsuarioDeEjecucion, leer, verificadorScram } from "./usuario-ejecucion";

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

describe("verificador SCRAM", () => {
  it("cumple el ejemplo del RFC 7677: el servidor firma y reconoce la prueba del cliente", () => {
    const [, , claves] = verificadorScram("pencil", Buffer.from("W22ZaJ0SNY7soEsUEjb6gQ==", "base64")).split("$");
    const [almacenada, servidor] = claves.split(":").map((c) => Buffer.from(c, "base64"));
    const nonce = "rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0";
    const mensaje = `n=user,r=rOprNGfwEbeRWgbNEkqO,r=${nonce},s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096,c=biws,r=${nonce}`;
    expect(createHmac("sha256", servidor).update(mensaje).digest("base64")).toBe("6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=");
    const firma = createHmac("sha256", almacenada).update(mensaje).digest();
    const clave = Buffer.from(Buffer.from("dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=", "base64").map((b, i) => b ^ firma[i]));
    expect(createHash("sha256").update(clave).digest()).toEqual(almacenada);
  });

  it("lleva sal nueva cada vez y rechaza lo que no es ASCII imprimible", () => {
    expect(verificadorScram("misma")).not.toBe(verificadorScram("misma"));
    expect(() => verificadorScram("contraseña")).toThrow(/ASCII/);
    expect(() => verificadorScram("tab\there")).toThrow(/ASCII/);
  });
});

describe("usuario de ejecución en PostgreSQL", () => {
  const USUARIO = "bodegasosur_prueba_scram";
  const url = (contrasena: string) => {
    const u = new URL(URL_PRUEBAS);
    u.username = USUARIO;
    u.password = contrasena;
    return u.toString();
  };
  const dueno = async (sql: string) => {
    const c = new Client({ connectionString: URL_PRUEBAS });
    await c.connect();
    try {
      await c.query(sql);
    } finally {
      await c.end();
    }
  };
  const entra = async (contrasena: string) => {
    const c = new Client({ connectionString: url(contrasena) });
    await c.connect();
    try {
      return (await c.query<{ u: string }>("SELECT current_user AS u")).rows[0].u;
    } finally {
      await c.end();
    }
  };

  // El rol es del clúster, no de la base que se recrea: se borra antes y después.
  beforeAll(() => dueno(`DROP ROLE IF EXISTS ${USUARIO}`));
  afterAll(() => dueno(`DROP ROLE IF EXISTS ${USUARIO}`));

  it("crea y actualiza el usuario sin mandar la contraseña, y entra solo con la vigente", async () => {
    const primera = randomBytes(18).toString("base64url");
    const segunda = randomBytes(18).toString("base64url");
    const consultas = vi.spyOn(Client.prototype, "query");
    try {
      expect(await asegurarUsuarioDeEjecucion(URL_PRUEBAS, url(primera))).toMatchObject({ creado: true });
      expect(await asegurarUsuarioDeEjecucion(URL_PRUEBAS, url(segunda))).toMatchObject({ creado: false });
      const enviado = JSON.stringify(consultas.mock.calls);
      expect(enviado).toContain("SCRAM-SHA-256$4096:");
      expect(enviado).not.toContain(primera);
      expect(enviado).not.toContain(segunda);
    } finally {
      consultas.mockRestore();
    }
    expect(await entra(segunda)).toBe(USUARIO);
    await expect(entra(primera)).rejects.toMatchObject({ code: "28P01" });
  });
});
