/*
  Vista previa local de la alerta diaria con datos de ejemplo
  Para ejecutar: npm run correo:muestra
*/

import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generarResumen, TOPE_RENGLONES } from "../src/lib/correo/plantilla";
import type { RenglonBajoMinimo } from "../src/lib/reportes/existencias";

const renglon = (bodega: string, clave: string, descripcion: string, unidad: string, existencia: number, minimo: number): RenglonBajoMinimo => ({
  bodega, claveArticulo: clave, descripcion, unidad, existencia, minimo,
});

const renglones = [
  renglon("Bodega Central", "ART-00012", "ACEITE MULTIGRADO 15W-40 GARRAFA 19 L", "PZA", 2, 6),
  renglon("Bodega Central", "ART-00031", "FILTRO DE DIÉSEL <DISPENSARIO> & \"MANGUERA\"", "PZA", 0, 4),
  renglon("Bodega Central", "ART-00102", "PAPEL TÉRMICO 80 × 70 MM", "CAJA", 1, 3),
  renglon("Bodega Central", "ART-00140", "VÁLVULA DE CORTE RECONECTABLE 3/4\" PARA MANGUERA DE DISPENSARIO DE GASOLINA", "PZA", 0, 4),
  renglon("Bodega Central", "ART-00141", "KIT DE REPARACIÓN PARA PISTOLA DE DESPACHO DIÉSEL 1\" CON EMPAQUES, RESORTES Y TORNILLERÍA COMPLETA DE REPUESTO", "PZA", 1, 5),
  renglon("Bodega Central", "ART-00177", "CINTA ADHESIVA", "PZA", 0, 2),
  renglon("Bodega Norte", "ART-00012", "ACEITE MULTIGRADO 15W-40 GARRAFA 19 L", "PZA", 0, 6),
  renglon("Bodega Norte", "ART-00205", "ADAPTADOR DE BRONCE 4\" PARA TANQUE DE ALMACENAMIENTO", "PZA", 0, 4),
  renglon("Bodega Norte", "ART-00250", "GUANTES DE NITRILO TALLA M", "CAJA", 3, 10),
  renglon("Bodega Norte", "ART-00312", "TRAMO DE MANGUERA 20 CM", "PZA", 1.5, 5),
].slice(0, TOPE_RENGLONES);

async function main() {
  const correo = await generarResumen({
    articulos: 9,
    renglones,
    urlReporte: "http://localhost:3000/reportes/existencias?bajo=1",
  });

  const base = join(tmpdir(), "bodegasosur-alerta-diaria");
  await writeFile(`${base}.html`, correo.html);
  await writeFile(`${base}.txt`, correo.texto);
  console.log(`Asunto: ${correo.asunto}\nHTML:   ${base}.html\nTexto:  ${base}.txt`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
