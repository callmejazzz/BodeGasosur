import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

// Datos verosímiles de una operación gasolinera. No son los reales de Gasosur:
// están para que la demo se vea creíble y para que Compras corrija sobre algo
// concreto en lugar de sobre una pantalla vacía.

const unidades = [
  { clave: "PZA", nombre: "Pieza" },
  { clave: "LT", nombre: "Litro" },
  { clave: "GAL", nombre: "Galón" },
  { clave: "CAJA", nombre: "Caja" },
  { clave: "KG", nombre: "Kilogramo" },
  { clave: "PAR", nombre: "Par" },
  { clave: "ROLLO", nombre: "Rollo" },
  { clave: "MT", nombre: "Metro" },
  { clave: "CUB", nombre: "Cubeta" },
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
  { clave: "BOD-01", nombre: "Bodega Central", ubicacion: "Matriz — Av. Principal 1200" },
  { clave: "BOD-02", nombre: "Bodega Norte", ubicacion: "Parque industrial, nave 4" },
  { clave: "BOD-03", nombre: "Bodega Sur", ubicacion: "Carretera federal km 18" },
];

const estaciones = [
  { clave: "EST-01", nombre: "Gasosur Centro", ubicacion: "Av. Juárez 450" },
  { clave: "EST-02", nombre: "Gasosur Reforma", ubicacion: "Paseo Reforma 88" },
  { clave: "EST-03", nombre: "Gasosur Aeropuerto", ubicacion: "Blvd. Aeropuerto km 3" },
  { clave: "EST-04", nombre: "Gasosur Industrial", ubicacion: "Parque industrial, lote 22" },
  { clave: "EST-05", nombre: "Gasosur Universidad", ubicacion: "Av. Universidad 1500" },
  { clave: "EST-06", nombre: "Gasosur Libramiento", ubicacion: "Libramiento norte km 7" },
  { clave: "EST-07", nombre: "Gasosur Puerto", ubicacion: "Zona portuaria, acceso 2" },
  { clave: "EST-08", nombre: "Gasosur Las Palmas", ubicacion: "Col. Las Palmas, calle 9" },
  { clave: "EST-09", nombre: "Gasosur Carretera", ubicacion: "Carretera federal km 42" },
  { clave: "EST-10", nombre: "Gasosur Mercado", ubicacion: "Calle Hidalgo 210" },
];

const areas = [
  "Despacho",
  "Tienda de conveniencia",
  "Mantenimiento",
  "Administración",
  "Limpieza",
  "Seguridad e higiene",
  "Patio y jardinería",
];

const proveedores = [
  { razonSocial: "Refacciones y Equipos del Golfo, S.A. de C.V.", rfc: "REG980412H23", contacto: "Mariana Cordero", telefono: "993 155 4420" },
  { razonSocial: "Lubricantes Industriales del Sureste, S.A.", rfc: "LIS030918QK7", contacto: "Enrique Valadez", telefono: "993 122 8890" },
  { razonSocial: "Papelería y Consumibles Delta", rfc: "PCD110627RT1", contacto: "Sofía Rentería", telefono: "993 188 2031" },
  { razonSocial: "Uniformes Corporativos Peninsular", rfc: "UCP070215MN4", contacto: "Ricardo Peña", telefono: "999 340 1177" },
  { razonSocial: "Distribuidora de Limpieza Aurora", rfc: "DLA150803PB9", contacto: "Verónica Salas", telefono: "993 199 6654" },
  { razonSocial: "Seguridad Industrial Tabasco, S. de R.L.", rfc: "SIT120530LD5", contacto: "Joaquín Herrera", telefono: "993 177 3308" },
  { razonSocial: "Ferretería y Herramientas del Centro", rfc: "FHC960214XA2", contacto: "Alma Domínguez", telefono: "993 144 5512" },
];

const personas = [
  { nombre: "Laura Beltrán Ríos", puesto: "Jefa de Compras" },
  { nombre: "Ernesto Márquez Solís", puesto: "Gerente de Operaciones" },
  { nombre: "Patricia Nava Cordero", puesto: "Analista de Compras" },
  { nombre: "Gerardo Ibarra Luna", puesto: "Almacenista — Bodega Central" },
  { nombre: "Rosa Elena Aguilar", puesto: "Almacenista — Bodega Norte" },
  { nombre: "Hugo Trejo Camacho", puesto: "Almacenista — Bodega Sur" },
  { nombre: "Miguel Ángel Ponce", puesto: "Chofer", esTransportista: true },
  { nombre: "Fernando Cruz Medina", puesto: "Chofer", esTransportista: true },
  { nombre: "Adriana Villalobos", puesto: "Auxiliar de logística", esTransportista: true },
  { nombre: "Carlos Zamudio Ortiz", puesto: "Encargado de estación" },
  { nombre: "Diana Robles Peña", puesto: "Encargada de estación" },
  { nombre: "Israel Fuentes Barrera", puesto: "Supervisor de mantenimiento" },
];

// clave, descripción, unidad, categoría, stock mínimo
const articulos: [string, string, string, string, number][] = [
  ["REF-1001", "Manguera de despacho 3/4\" x 4 m", "PZA", "Refacciones de dispensario", 6],
  ["REF-1002", "Pistola de despacho automática", "PZA", "Refacciones de dispensario", 4],
  ["REF-1003", "Filtro de partículas para dispensario", "PZA", "Refacciones de dispensario", 12],
  ["REF-1004", "Válvula rompe-impacto (breakaway)", "PZA", "Refacciones de dispensario", 4],
  ["REF-1005", "Swivel giratorio 3/4\"", "PZA", "Refacciones de dispensario", 8],
  ["REF-1006", "Kit de empaques para bomba sumergible", "PZA", "Refacciones de dispensario", 3],
  ["REF-1007", "Display digital de dispensario", "PZA", "Refacciones de dispensario", 2],
  ["REF-1008", "Tapa de registro de tanque", "PZA", "Refacciones de dispensario", 5],
  ["LUB-2001", "Aceite multigrado 20W-50 (cubeta 19 L)", "CUB", "Lubricantes y aditivos", 10],
  ["LUB-2002", "Aceite sintético 5W-30 (litro)", "LT", "Lubricantes y aditivos", 48],
  ["LUB-2003", "Grasa multiusos (kg)", "KG", "Lubricantes y aditivos", 15],
  ["LUB-2004", "Aditivo limpiador de inyectores", "PZA", "Lubricantes y aditivos", 24],
  ["LUB-2005", "Líquido para frenos DOT-4 (500 ml)", "PZA", "Lubricantes y aditivos", 18],
  ["LUB-2006", "Anticongelante concentrado (galón)", "GAL", "Lubricantes y aditivos", 12],
  ["PAP-3001", "Rollo térmico 57 x 60 mm para punto de venta", "ROLLO", "Papelería", 120],
  ["PAP-3002", "Papel bond carta (paquete 500 hojas)", "PAQ", "Papelería", 30],
  ["PAP-3003", "Bolígrafo negro (caja 12 pzas)", "CAJA", "Papelería", 20],
  ["PAP-3004", "Carpeta de argollas 2\"", "PZA", "Papelería", 25],
  ["PAP-3005", "Talonario de vales de salida", "PZA", "Papelería", 15],
  ["PAP-3006", "Tóner para impresora láser", "PZA", "Papelería", 6],
  ["UNI-4001", "Camisola de despachador talla M", "PZA", "Uniformes", 20],
  ["UNI-4002", "Camisola de despachador talla G", "PZA", "Uniformes", 20],
  ["UNI-4003", "Pantalón de trabajo talla 32", "PZA", "Uniformes", 15],
  ["UNI-4004", "Gorra institucional", "PZA", "Uniformes", 30],
  ["UNI-4005", "Chaleco reflejante", "PZA", "Uniformes", 25],
  ["UNI-4006", "Botas de seguridad (par)", "PAR", "Uniformes", 12],
  ["LIM-5001", "Detergente industrial (cubeta 20 L)", "CUB", "Material de limpieza", 8],
  ["LIM-5002", "Cloro (galón)", "GAL", "Material de limpieza", 20],
  ["LIM-5003", "Franela (metro)", "MT", "Material de limpieza", 60],
  ["LIM-5004", "Escoba de plástico", "PZA", "Material de limpieza", 15],
  ["LIM-5005", "Bolsa negra para basura (paquete 50 pzas)", "PAQ", "Material de limpieza", 40],
  ["LIM-5006", "Papel higiénico jumbo (caja 12 rollos)", "CAJA", "Material de limpieza", 25],
  ["LIM-5007", "Jabón líquido para manos (galón)", "GAL", "Material de limpieza", 18],
  ["SEG-6001", "Extintor PQS 9 kg", "PZA", "Equipo de seguridad", 10],
  ["SEG-6002", "Guantes de nitrilo (par)", "PAR", "Equipo de seguridad", 50],
  ["SEG-6003", "Lentes de seguridad", "PZA", "Equipo de seguridad", 30],
  ["SEG-6004", "Botiquín de primeros auxilios", "PZA", "Equipo de seguridad", 8],
  ["SEG-6005", "Cono de señalización 71 cm", "PZA", "Equipo de seguridad", 24],
  ["SEG-6006", "Cinta de precaución (rollo 200 m)", "ROLLO", "Equipo de seguridad", 12],
  ["HER-7001", "Juego de llaves mixtas 8-22 mm", "PZA", "Herramienta", 3],
  ["HER-7002", "Desarmador plano 1/4\"", "PZA", "Herramienta", 10],
  ["HER-7003", "Multímetro digital", "PZA", "Herramienta", 3],
  ["HER-7004", "Pinza de electricista 8\"", "PZA", "Herramienta", 6],
  ["ELE-8001", "Lámpara LED 40 W para marquesina", "PZA", "Material eléctrico", 20],
  ["ELE-8002", "Cable THW calibre 12 (metro)", "MT", "Material eléctrico", 200],
  ["ELE-8003", "Contactor magnético 25 A", "PZA", "Material eléctrico", 5],
  ["ELE-8004", "Cinta de aislar (rollo)", "ROLLO", "Material eléctrico", 30],
  ["TDA-9001", "Vaso desechable 12 oz (paquete 50 pzas)", "PAQ", "Consumibles de tienda", 40],
  ["TDA-9002", "Bolsa de papel para tienda (paquete 100 pzas)", "PAQ", "Consumibles de tienda", 30],
  ["TDA-9003", "Servilleta desechable (paquete 500 pzas)", "PAQ", "Consumibles de tienda", 35],
];

async function main() {
  console.log("Sembrando catálogos de BodeGasosur…");

  for (const u of unidades) {
    await prisma.unidadMedida.upsert({
      where: { clave: u.clave },
      update: { nombre: u.nombre },
      create: u,
    });
  }
  console.log(`  ✓ ${unidades.length} unidades de medida`);

  for (const nombre of categorias) {
    await prisma.categoriaArticulo.upsert({ where: { nombre }, update: {}, create: { nombre } });
  }
  console.log(`  ✓ ${categorias.length} categorías`);

  for (const b of bodegas) {
    await prisma.bodega.upsert({ where: { clave: b.clave }, update: b, create: b });
  }
  console.log(`  ✓ ${bodegas.length} bodegas`);

  for (const e of estaciones) {
    await prisma.estacion.upsert({ where: { clave: e.clave }, update: e, create: e });
  }
  console.log(`  ✓ ${estaciones.length} estaciones`);

  for (const nombre of areas) {
    await prisma.area.upsert({ where: { nombre }, update: {}, create: { nombre } });
  }
  console.log(`  ✓ ${areas.length} áreas`);

  for (const p of proveedores) {
    await prisma.proveedor.upsert({
      where: { rfc: p.rfc },
      update: p,
      create: p,
    });
  }
  console.log(`  ✓ ${proveedores.length} proveedores`);

  for (const p of personas) {
    const existente = await prisma.persona.findFirst({ where: { nombre: p.nombre } });
    if (existente) {
      await prisma.persona.update({ where: { id: existente.id }, data: p });
    } else {
      await prisma.persona.create({ data: p });
    }
  }
  console.log(`  ✓ ${personas.length} personas`);

  const unidadPorClave = new Map(
    (await prisma.unidadMedida.findMany()).map((u) => [u.clave, u.id]),
  );
  const categoriaPorNombre = new Map(
    (await prisma.categoriaArticulo.findMany()).map((c) => [c.nombre, c.id]),
  );

  for (const [clave, descripcion, unidad, categoria, stockMinimo] of articulos) {
    const unidadId = unidadPorClave.get(unidad);
    const categoriaId = categoriaPorNombre.get(categoria);
    if (!unidadId) throw new Error(`Unidad desconocida: ${unidad}`);
    if (!categoriaId) throw new Error(`Categoría desconocida: ${categoria}`);

    const datos = { descripcion, unidadId, categoriaId, stockMinimo };
    await prisma.articulo.upsert({
      where: { clave },
      update: datos,
      create: { clave, ...datos },
    });
  }
  console.log(`  ✓ ${articulos.length} artículos`);

  const folios = [
    { tipo: "ENTRADA" as const, prefijo: "E" },
    { tipo: "SALIDA" as const, prefijo: "S" },
    { tipo: "TRASPASO" as const, prefijo: "T" },
    { tipo: "AJUSTE" as const, prefijo: "A" },
  ];
  for (const f of folios) {
    await prisma.folio.upsert({ where: { tipo: f.tipo }, update: {}, create: f });
  }
  console.log(`  ✓ ${folios.length} consecutivos de folio`);

  console.log("Listo.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
