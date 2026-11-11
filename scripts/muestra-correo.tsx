/*
  Vista previa local de la alerta diaria con datos de ejemplo (contrato fase 9,
  §3.3). No lee la base ni envía nada: escribe el HTML y el texto en la carpeta
  temporal del sistema e imprime sus rutas.

    npm run correo:muestra
*/

import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generarResumen } from "../src/lib/correo/plantilla";
import type { RenglonBajoMinimo } from "../src/lib/reportes/existencias";

const renglon = (bodega: string, clave: string, descripcion: string, unidad: string, existencia: number, minimo: number): RenglonBajoMinimo => ({
  bodega, claveArticulo: clave, descripcion, unidad, existencia, minimo, faltante: minimo - existencia,
});

const renglones = [
  renglon("Bodega Central", "ART-00012", "Aceite multigrado 15W-40, garrafa 19 L", "PZA", 2, 6),
  renglon("Bodega Central", "ART-00031", "Filtro de diésel <dispensario> & \"manguera\"", "PZA", 0, 4),
  renglon("Bodega Central", "ART-00102", "Papel térmico 80 × 70 mm", "CAJA", 1, 3),
  renglon("Bodega Norte", "ART-00012", "Aceite multigrado 15W-40, garrafa 19 L", "PZA", 0, 6),
  renglon("Bodega Norte", "ART-00250", "Guantes de nitrilo talla M", "CAJA", 3, 10),
];

async function main() {
  const correo = await generarResumen({
    fecha: "2026-11-10",
    articulos: 4,
    totalRenglones: renglones.length + 7,
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
