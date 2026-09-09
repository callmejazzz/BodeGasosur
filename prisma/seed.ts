import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

// Datos verosímiles de una operación gasolinera. No son los reales de Gasosur:
// están para que la demo se vea creíble y para que Compras corrija sobre algo
// concreto en lugar de sobre una pantalla vacía. Los reales llegan en la fase 4.
//
// Dos cosas que este archivo demuestra además de sembrar:
//
//   1. Toda la siembra corre dentro de una transacción que declara su origen.
//      La bitácora la escribe un trigger que ve a todos los escritores, así que
//      sin esta línea 300 renglones aparecerían como «escritura-directa».
//
//   2. Los artículos no traen clave: la asigna la base por secuencia. Por eso
//      la siembra es idempotente por descripción y no por clave.

const unidades = [
  { clave: "PZA", nombre: "Pieza" },
  { clave: "CAJA", nombre: "Caja" },
  { clave: "CUB", nombre: "Cubeta" },
  { clave: "ROLLO", nombre: "Rollo" },
  { clave: "PAR", nombre: "Par" },
  { clave: "PAQ", nombre: "Paquete" },
];

const categorias = [
  "Refacciones de dispensario",
  "Lubricantes y aditivos",
  "Papelería",
  "Uniformes",
  "Material de limpieza",
  "Equipo de seguridad",
  "Herramienta",
  "Material eléctrico",
  "Consumibles de tienda",
];

const bodegas = [
  { clave: "MAG", nombre: "Magallanes", ubicacion: "Matriz — Av. Principal 1200" },
  { clave: "SFE", nombre: "Servi Fer", ubicacion: "Parque industrial, nave 4" },
];

// Las empresas del grupo. Viven en el esquema global: otros proyectos las leen.
const empresas = [
  { razonSocial: "Combustibles del Pacífico Sur, S.A. de C.V.", rfc: "CPS980412H23" },
  { razonSocial: "Servicio Magallanes, S.A. de C.V.", rfc: "SMA030918QK7" },
  { razonSocial: "Estaciones Vacacional, S.A. de C.V.", rfc: "EVA110627RT1" },
  { razonSocial: "Operadora San Marcos, S. de R.L.", rfc: "OSM070215MN4" },
];

// numero, alias, RFC de la empresa que la opera
const estaciones: [string, string, string][] = [
  ["ES05588", "Magallanes", "SMA030918QK7"],
  ["ES05612", "Vacacional", "EVA110627RT1"],
  ["ES05634", "San Marcos", "OSM070215MN4"],
  ["ES05701", "Alborada", "CPS980412H23"],
  ["ES05744", "Costera", "CPS980412H23"],
  ["ES05780", "Aeropuerto", "CPS980412H23"],
  ["ES05812", "Universidad", "SMA030918QK7"],
  ["ES05866", "Libramiento", "EVA110627RT1"],
  ["ES05903", "Puerto", "OSM070215MN4"],
  ["ES05947", "Las Palmas", "CPS980412H23"],
];

// Las tres áreas fijas que quedaron del levantamiento. Ni una más.
const areas = ["Administración", "Mantenimiento", "Despacho"];

// Razón social y RFC viven en Empresa: 33 de los 137 proveedores reales son
// del propio grupo, así que el proveedor apunta a una empresa en vez de
// repetir sus datos fiscales.
const proveedores = [
  { razonSocial: "Refacciones y Equipos del Golfo, S.A. de C.V.", rfc: "REG980412H23", nombreComercial: "Refaccionaria del Golfo", contacto: "Mariana Cordero", telefono: "744 155 4420", giro: "Refacciones" },
  { razonSocial: "Lubricantes Industriales del Sureste, S.A.", rfc: "LIS030918QK7", nombreComercial: "Lubrisur", contacto: "Enrique Valadez", telefono: "744 122 8890", giro: "Lubricantes" },
  { razonSocial: "Papelería y Consumibles Delta, S.A. de C.V.", rfc: "PCD110627RT1", nombreComercial: "Papelería Delta", contacto: "Sofía Rentería", telefono: "744 188 2031", giro: "Papelería" },
  { razonSocial: "Uniformes Corporativos Peninsular, S.A.", rfc: "UCP070215MN4", nombreComercial: "Uniformes Peninsular", contacto: "Ricardo Peña", telefono: "999 340 1177", giro: "Uniformes" },
  { razonSocial: "Distribuidora de Limpieza Aurora, S. de R.L.", rfc: "DLA150803PB9", nombreComercial: "Limpieza Aurora", contacto: "Verónica Salas", telefono: "744 199 6654", giro: "Limpieza" },
  { razonSocial: "Seguridad Industrial Guerrero, S. de R.L.", rfc: "SIG120530LD5", nombreComercial: "Seguridad Guerrero", contacto: "Joaquín Herrera", telefono: "744 177 3308", giro: "Equipo de seguridad" },
  { razonSocial: "Ferretería y Herramientas del Centro, S.A.", rfc: "FHC960214XA2", nombreComercial: "Ferretería del Centro", contacto: "Alma Domínguez", telefono: "744 144 5512", giro: "Ferretería" },
];

const personas = [
  { nombre: "Laura Beltrán Ríos", puesto: "Jefa de Compras" },
  { nombre: "Ernesto Márquez Solís", puesto: "Gerente de Operaciones" },
  { nombre: "Patricia Nava Cordero", puesto: "Analista de Compras" },
  { nombre: "Gerardo Ibarra Luna", puesto: "Almacenista — Magallanes" },
  { nombre: "Rosa Elena Aguilar", puesto: "Almacenista — Servi Fer" },
  { nombre: "Hugo Trejo Camacho", puesto: "Dirección" },
  { nombre: "Carlos Zamudio Ortiz", puesto: "Gerente de estación" },
  { nombre: "Diana Robles Peña", puesto: "Gerente de estación" },
  { nombre: "Israel Fuentes Barrera", puesto: "Supervisor de mantenimiento" },
];

// descripción, unidad, categoría, stock mínimo (piezas), piezas por caja
const articulos: [string, string, string, number, number | null][] = [
  ["Manguera de despacho 3/4\" x 4 m", "PZA", "Refacciones de dispensario", 6, null],
  ["Pistola de despacho automática", "PZA", "Refacciones de dispensario", 4, null],
  ["Filtro de partículas para dispensario", "PZA", "Refacciones de dispensario", 12, null],
  ["Válvula rompe-impacto (breakaway)", "PZA", "Refacciones de dispensario", 4, null],
  ["Swivel giratorio 3/4\"", "PZA", "Refacciones de dispensario", 8, null],
  ["Kit de empaques para bomba sumergible", "PZA", "Refacciones de dispensario", 3, null],
  ["Display digital de dispensario", "PZA", "Refacciones de dispensario", 2, null],
  ["Tapa de registro de tanque", "PZA", "Refacciones de dispensario", 5, null],
  ["Válvula Skinner recta de 2 hilos 24V", "PZA", "Refacciones de dispensario", 6, null],
  ["Medidor Bennet RU gasolina/diésel", "PZA", "Refacciones de dispensario", 2, null],

  ["Aceite multigrado 20W-50 (cubeta 19 L)", "CUB", "Lubricantes y aditivos", 10, null],
  ["Aceite sintético 5W-30 (botella 1 L)", "PZA", "Lubricantes y aditivos", 48, 12],
  ["Grasa multiusos (bote 1 kg)", "PZA", "Lubricantes y aditivos", 15, null],
  ["Aditivo limpiador de inyectores", "PZA", "Lubricantes y aditivos", 24, 12],
  ["Líquido para frenos DOT-4 (500 ml)", "PZA", "Lubricantes y aditivos", 18, 24],
  ["Anticongelante concentrado (garrafa 1 gal)", "PZA", "Lubricantes y aditivos", 12, 4],

  ["Rollo térmico 57 x 60 mm para punto de venta", "ROLLO", "Papelería", 120, null],
  ["Papel bond carta (paquete 500 hojas)", "PAQ", "Papelería", 30, null],
  ["Bolígrafo negro", "PZA", "Papelería", 240, 12],
  ["Carpeta de argollas 2\"", "PZA", "Papelería", 25, null],
  ["Talonario de vales de salida", "PZA", "Papelería", 15, null],
  ["Tóner para impresora láser", "PZA", "Papelería", 6, null],

  ["Camisola de despachador talla M", "PZA", "Uniformes", 20, null],
  ["Camisola de despachador talla G", "PZA", "Uniformes", 20, null],
  ["Pantalón de trabajo talla 32", "PZA", "Uniformes", 15, null],
  ["Gorra institucional", "PZA", "Uniformes", 30, null],
  ["Chaleco reflejante", "PZA", "Uniformes", 25, null],
  ["Botas de seguridad", "PAR", "Uniformes", 12, null],

  ["Detergente industrial (cubeta 20 L)", "CUB", "Material de limpieza", 8, null],
  ["Cloro (garrafa 1 gal)", "PZA", "Material de limpieza", 20, 4],
  ["Franela (tramo de 1 m)", "PZA", "Material de limpieza", 60, null],
  ["Escoba de plástico", "PZA", "Material de limpieza", 15, null],
  ["Bolsa negra para basura (paquete 50 pzas)", "PAQ", "Material de limpieza", 40, null],
  ["Papel higiénico jumbo", "PZA", "Material de limpieza", 300, 12],
  ["Jabón líquido para manos (garrafa 1 gal)", "PZA", "Material de limpieza", 18, 4],

  ["Extintor PQS 9 kg", "PZA", "Equipo de seguridad", 10, null],
  ["Guantes de nitrilo", "PAR", "Equipo de seguridad", 50, null],
  ["Lentes de seguridad", "PZA", "Equipo de seguridad", 30, null],
  ["Botiquín de primeros auxilios", "PZA", "Equipo de seguridad", 8, null],
  ["Cono de señalización 71 cm", "PZA", "Equipo de seguridad", 24, null],
  ["Cinta de precaución (rollo 200 m)", "ROLLO", "Equipo de seguridad", 12, null],

  ["Juego de llaves mixtas 8-22 mm", "PZA", "Herramienta", 3, null],
  ["Desarmador plano 1/4\"", "PZA", "Herramienta", 10, null],
  ["Multímetro digital", "PZA", "Herramienta", 3, null],
  ["Pinza de electricista 8\"", "PZA", "Herramienta", 6, null],

  ["Lámpara LED 40 W para marquesina", "PZA", "Material eléctrico", 20, null],
  ["Cable THW calibre 12 (rollo 100 m)", "ROLLO", "Material eléctrico", 4, null],
  ["Contactor magnético 25 A", "PZA", "Material eléctrico", 5, null],
  ["Cinta de aislar", "ROLLO", "Material eléctrico", 30, 10],

  ["Vaso desechable 12 oz (paquete 50 pzas)", "PAQ", "Consumibles de tienda", 40, null],
  ["Bolsa de papel para tienda (paquete 100 pzas)", "PAQ", "Consumibles de tienda", 30, null],
  ["Servilleta desechable (paquete 500 pzas)", "PAQ", "Consumibles de tienda", 35, null],
];

const folios = [
  { tipo: "ENTRADA" as const, prefijo: "E" },
  { tipo: "SALIDA" as const, prefijo: "S" },
  { tipo: "TRASPASO" as const, prefijo: "T" },
  { tipo: "DEVOLUCION" as const, prefijo: "D" },
  { tipo: "AJUSTE" as const, prefijo: "A" },
];

async function main() {
  console.log("Sembrando catálogos de BodeGasosur…");

  await prisma.$transaction(
    async (tx) => {
      // Sin esto, cada renglón sembrado aparecería en la bitácora como
      // «escritura-directa». Es el mismo contrato que cumple accionProtegida.
      await tx.$executeRawUnsafe("SET LOCAL app.origen = 'siembra'");

      for (const u of unidades) {
        await tx.unidadMedida.upsert({
          where: { clave: u.clave },
          update: { nombre: u.nombre },
          create: u,
        });
      }
      console.log(`  ✓ ${unidades.length} unidades de medida (presentación, no magnitud)`);

      for (const nombre of categorias) {
        await tx.categoriaArticulo.upsert({ where: { nombre }, update: {}, create: { nombre } });
      }
      console.log(`  ✓ ${categorias.length} categorías`);

      for (const b of bodegas) {
        await tx.bodega.upsert({ where: { clave: b.clave }, update: b, create: b });
      }
      console.log(`  ✓ ${bodegas.length} bodegas`);

      for (const nombre of areas) {
        await tx.area.upsert({ where: { nombre }, update: {}, create: { nombre } });
      }
      console.log(`  ✓ ${areas.length} áreas`);

      // ── Catálogo global del grupo ──────────────────────────────────────
      for (const e of empresas) {
        await tx.empresa.upsert({ where: { rfc: e.rfc }, update: e, create: e });
      }
      for (const p of proveedores) {
        await tx.empresa.upsert({
          where: { rfc: p.rfc },
          update: { razonSocial: p.razonSocial },
          create: { razonSocial: p.razonSocial, rfc: p.rfc },
        });
      }
      const empresaPorRfc = new Map(
        (await tx.empresa.findMany()).map((e) => [e.rfc!, e.id]),
      );
      console.log(`  ✓ ${empresaPorRfc.size} empresas en catalogo_gasosur`);

      for (const [numero, alias, rfc] of estaciones) {
        const empresaId = empresaPorRfc.get(rfc);
        if (!empresaId) throw new Error(`Empresa desconocida para ${numero}: ${rfc}`);
        await tx.estacion.upsert({
          where: { numero },
          update: { alias, empresaId },
          create: { numero, alias, empresaId },
        });
      }
      console.log(`  ✓ ${estaciones.length} estaciones en catalogo_gasosur`);

      // ── Proveedores, ya enlazados a su empresa ─────────────────────────
      for (const p of proveedores) {
        const empresaId = empresaPorRfc.get(p.rfc)!;
        const datos = {
          empresaId,
          nombreComercial: p.nombreComercial,
          contacto: p.contacto,
          telefono: p.telefono,
          giro: p.giro,
        };
        const existente = await tx.proveedor.findFirst({
          where: { nombreComercial: p.nombreComercial },
        });
        if (existente) {
          await tx.proveedor.update({ where: { id: existente.id }, data: datos });
        } else {
          await tx.proveedor.create({ data: datos });
        }
      }
      console.log(`  ✓ ${proveedores.length} proveedores`);

      for (const p of personas) {
        const existente = await tx.persona.findFirst({ where: { nombre: p.nombre } });
        if (existente) {
          await tx.persona.update({ where: { id: existente.id }, data: p });
        } else {
          await tx.persona.create({ data: p });
        }
      }
      console.log(`  ✓ ${personas.length} personas`);

      // ── Artículos: la clave la pone la base, no este archivo ───────────
      const unidadPorClave = new Map(
        (await tx.unidadMedida.findMany()).map((u) => [u.clave, u.id]),
      );
      const categoriaPorNombre = new Map(
        (await tx.categoriaArticulo.findMany()).map((c) => [c.nombre, c.id]),
      );

      for (const [descripcion, unidad, categoria, stockMinimo, piezasPorCaja] of articulos) {
        const unidadId = unidadPorClave.get(unidad);
        const categoriaId = categoriaPorNombre.get(categoria);
        if (!unidadId) throw new Error(`Unidad desconocida: ${unidad}`);
        if (!categoriaId) throw new Error(`Categoría desconocida: ${categoria}`);

        const datos = { unidadId, categoriaId, stockMinimo, piezasPorCaja };
        const existente = await tx.articulo.findFirst({ where: { descripcion } });
        if (existente) {
          await tx.articulo.update({ where: { id: existente.id }, data: datos });
        } else {
          await tx.articulo.create({ data: { descripcion, ...datos } });
        }
      }
      const primero = await tx.articulo.findFirst({ orderBy: { clave: "asc" } });
      const ultimo = await tx.articulo.findFirst({ orderBy: { clave: "desc" } });
      console.log(`  ✓ ${articulos.length} artículos (${primero?.clave} … ${ultimo?.clave})`);

      for (const f of folios) {
        await tx.folio.upsert({ where: { tipo: f.tipo }, update: {}, create: f });
      }
      console.log(`  ✓ ${folios.length} consecutivos de folio`);

      // ── El Superadmin no se siembra aquí ───────────────────────────────
      //
      // Clerk identifica; la fila en `Usuario` decide el acceso. Sin fila no se
      // entra, ni con una sesión válida — es la negación por omisión.
      //
      // Ese enlace lo hace `scripts/arranque-superadmin.ts`, que resuelve el
      // identificador de Clerk a partir del correo en vez de pedirlo copiado a
      // mano, y se niega a correr si ya hay otro Superadmin. `db:reset` lo
      // encadena después de esta siembra. Un solo escritor para esa fila.
    },
    { timeout: 60_000 },
  );

  console.log("Listo.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
