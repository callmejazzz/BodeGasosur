// Fixtures de desarrollo: datos demostrativos para construir y probar las
// fases 5 a 9 —entradas, salidas, traspasos, bajas, kardex y PEPS— sin esperar
// la lista normalizada de Compras. Nada de aquí es real, y nada de aquí pisa
// producción: ver la guardia de abajo.
//
// Dan por hecho la configuración mínima (prisma/configuracion.ts) y los
// catálogos migrados (prisma/migracion-datos/): usan la unidad PZA y no crean
// estaciones. Tampoco tocan Empresa: ese catálogo es solo de las empresas de
// Gasosur, y el proveedor lleva sus propios datos fiscales.
//
// Solo crean lo que falta, por descripción o nombre, y firman «fixtures» en la
// bitácora. Cuando lleguen las fases de movimientos, los movimientos de
// prueba se agregan aquí, a través de la capa de servicios.
//
// Uso:  npm run db:fixtures

import {
  VALOR_DE_AUTORIZACION,
  VARIABLE_DE_AUTORIZACION,
  buscarPorNombre,
  contarDatosOperativos,
  crearClienteDelDueno,
  describirBase,
  esEjecucionDirecta,
  type Tx,
} from "./comun";

// ── La guardia ─────────────────────────────────────────────────────────────
//
// Falla por omisión. Tres condiciones, y las tres tienen que cumplirse:
//
//   1. BODEGASOSUR_FIXTURES=permitidos en el entorno. Es una variable que solo
//      existe en el .env de una máquina de desarrollo; no está en ningún
//      entorno de producción ni en el .env.example sin comentar.
//   2. NODE_ENV distinto de "production".
//   3. La base no tiene movimientos ni existencias: un fixture no es una
//      migración, y una base que ya opera no es su lugar.

export async function verificarGuardia(db: Tx): Promise<void> {
  if (process.env[VARIABLE_DE_AUTORIZACION] !== VALOR_DE_AUTORIZACION) {
    throw new Error(
      `Los fixtures son solo de desarrollo y hay que autorizarlos: ${VARIABLE_DE_AUTORIZACION}=${VALOR_DE_AUTORIZACION} en .env.`,
    );
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("Los fixtures no corren con NODE_ENV=production.");
  }
  const { movimientos, existencias } = await contarDatosOperativos(db);
  if (movimientos > 0 || existencias > 0) {
    const { base, servidor } = describirBase();
    throw new Error(
      `La base ${base} en ${servidor} ya opera (${movimientos} movimientos, ${existencias} existencias). ` +
        "Los fixtures solo entran a una base sin operación.",
    );
  }
}

// ── Los datos ──────────────────────────────────────────────────────────────

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

// Razones sociales y RFC inventados, para que ninguno se confunda con uno real.
const proveedores = [
  { razonSocial: "Refacciones y Equipos del Golfo, S.A. de C.V.", rfc: "REG980412H23", nombreComercial: "Refaccionaria del Golfo", contacto: "Mariana Cordero", telefono: "744 155 4420", giro: "Refacciones" },
  { razonSocial: "Lubricantes Industriales del Sureste, S.A.", rfc: "LIS030918QK7", nombreComercial: "Lubrisur", contacto: "Enrique Valadez", telefono: "744 122 8890", giro: "Lubricantes" },
  { razonSocial: "Papelería y Consumibles Delta, S.A. de C.V.", rfc: "PCD110627RT1", nombreComercial: "Papelería Delta", contacto: "Sofía Rentería", telefono: "744 188 2031", giro: "Papelería" },
  { razonSocial: "Uniformes Corporativos Peninsular, S.A.", rfc: "UCP070215MN4", nombreComercial: "Uniformes Peninsular", contacto: "Ricardo Peña", telefono: "999 340 1177", giro: "Uniformes" },
  { razonSocial: "Distribuidora de Limpieza Aurora, S. de R.L.", rfc: "DLA150803PB9", nombreComercial: "Limpieza Aurora", contacto: "Verónica Salas", telefono: "744 199 6654", giro: "Limpieza" },
  { razonSocial: "Seguridad Industrial Guerrero, S. de R.L.", rfc: "SIG120530LD5", nombreComercial: "Seguridad Guerrero", contacto: "Joaquín Herrera", telefono: "744 177 3308", giro: "Equipo de seguridad" },
  { razonSocial: "Ferretería y Herramientas del Centro, S.A.", rfc: "FHC960214XA2", nombreComercial: "Ferretería del Centro", contacto: "Alma Domínguez", telefono: "744 144 5512", giro: "Ferretería" },
];

// Quienes solicitan material en las pruebas de salidas. Nombres inventados.
const personas = [
  { nombre: "Ernesto Márquez Solís", puesto: "Gerente de estación" },
  { nombre: "Carlos Zamudio Ortiz", puesto: "Gerente de estación" },
  { nombre: "Israel Fuentes Barrera", puesto: "Supervisor de mantenimiento" },
];

export type ResumenFixtures = { creados: number; existentes: number };

export async function aplicarFixtures(tx: Tx): Promise<ResumenFixtures> {
  await verificarGuardia(tx);

  const resumen: ResumenFixtures = { creados: 0, existentes: 0 };
  const anotar = (existia: boolean) => (existia ? resumen.existentes++ : resumen.creados++);

  await tx.$executeRawUnsafe("SET LOCAL app.origen = 'fixtures'");

  for (const u of unidades) {
    const existente = await tx.unidadMedida.findUnique({ where: { clave: u.clave } });
    if (!existente) await tx.unidadMedida.create({ data: u });
    anotar(existente !== null);
  }

  for (const nombre of categorias) {
    const existente = await tx.categoriaArticulo.findUnique({ where: { nombre } });
    if (!existente) await tx.categoriaArticulo.create({ data: { nombre } });
    anotar(existente !== null);
  }

  const unidadPorClave = new Map((await tx.unidadMedida.findMany()).map((u) => [u.clave, u.id]));
  const categoriaPorNombre = new Map(
    (await tx.categoriaArticulo.findMany()).map((c) => [c.nombre, c.id]),
  );

  // Sin `clave`: la asigna la base por secuencia, igual que en la pantalla.
  for (const [descripcion, unidad, categoria, stockMinimo, piezasPorCaja] of articulos) {
    const unidadId = unidadPorClave.get(unidad);
    const categoriaId = categoriaPorNombre.get(categoria);
    if (!unidadId) throw new Error(`Unidad desconocida: ${unidad}`);
    if (!categoriaId) throw new Error(`Categoría desconocida: ${categoria}`);

    const existente = await tx.articulo.findFirst({ where: { descripcion } });
    if (!existente) {
      await tx.articulo.create({ data: { descripcion, unidadId, categoriaId, stockMinimo, piezasPorCaja } });
    }
    anotar(existente !== null);
  }

  for (const p of proveedores) {
    const existente = await buscarPorNombre(tx, "Proveedor", p.nombreComercial);
    if (!existente) await tx.proveedor.create({ data: p });
    anotar(existente !== null);
  }

  for (const p of personas) {
    const existente = await buscarPorNombre(tx, "Persona", p.nombre);
    if (!existente) await tx.persona.create({ data: p });
    anotar(existente !== null);
  }

  return resumen;
}

async function main() {
  const prisma = crearClienteDelDueno();
  try {
    const { base, servidor } = describirBase();
    console.log(`Aplicando fixtures de desarrollo en ${base} (${servidor})…`);
    const r = await prisma.$transaction((tx) => aplicarFixtures(tx), { timeout: 60_000 });
    console.log(
      `  ✓ ${unidades.length} unidades, ${categorias.length} categorías, ${articulos.length} artículos, ` +
        `${proveedores.length} proveedores y ${personas.length} personas de prueba — ` +
        `${r.creados} creados, ${r.existentes} ya existían.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (esEjecucionDirecta(import.meta.url)) {
  main().catch((e) => {
    console.error(e instanceof Error ? `✗ ${e.message}` : e);
    process.exit(1);
  });
}
