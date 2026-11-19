import type { CSSProperties } from "react";
import { Body, Container, Head, Heading, Hr, Html, Link, Preview, render, Section, Text } from "react-email";
import { aFechaDeBase } from "@/lib/fechas";
import type { RenglonBajoMinimo } from "@/lib/reportes/existencias";

export const TOPE_RENGLONES = 50;

export type DatosResumen = {
  /** Día operativo, AAAA-MM-DD. */
  fecha: string;
  articulos: number;
  totalRenglones: number;
  renglones: RenglonBajoMinimo[];
  urlReporte: string;
};

export type CorreoResumen = { asunto: string; html: string; texto: string };

export const asuntoDelResumen = (articulos: number) => `Stock bajo mínimo: ${articulos} ${articulos === 1 ? "artículo" : "artículos"}`;

const numero = new Intl.NumberFormat("es-MX");
const fechaLarga = (fecha: string) =>
  new Intl.DateTimeFormat("es-MX", { dateStyle: "full", timeZone: "UTC" }).format(aFechaDeBase(fecha));

const resumenDeN = (articulos: number) =>
  articulos === 1 ? "1 artículo está por debajo de su mínimo" : `${numero.format(articulos)} artículos están por debajo de su mínimo`;
const restantes = (m: number) => `Y ${numero.format(m)} ${m === 1 ? "renglón más" : "renglones más"}, que puedes ver en el reporte.`;
const COMO_DESACTIVAR =
  "Recibes este correo porque activaste la alerta diaria de stock mínimo. Puedes desactivarla desde tu perfil en BodeGasosur, apartado Preferencias.";

function porBodega(renglones: RenglonBajoMinimo[]): [string, RenglonBajoMinimo[]][] {
  const grupos = new Map<string, RenglonBajoMinimo[]>();
  for (const r of renglones) grupos.set(r.bodega, [...(grupos.get(r.bodega) ?? []), r]);
  return [...grupos];
}

const estilos = {
  cuerpo: { backgroundColor: "#f4f4f5", fontFamily: "Arial, Helvetica, sans-serif", color: "#18181b", margin: 0 },
  contenedor: { backgroundColor: "#ffffff", maxWidth: "640px", margin: "0 auto", padding: "24px" },
  titulo: { fontSize: "20px", margin: "0 0 8px" },
  texto: { fontSize: "14px", lineHeight: "20px", margin: "0 0 16px" },
  bodega: { fontSize: "15px", margin: "20px 0 8px" },
  tabla: { width: "100%", borderCollapse: "collapse", fontSize: "13px" },
  encabezado: { textAlign: "left", borderBottom: "1px solid #d4d4d8", padding: "6px 4px", color: "#52525b", fontWeight: "normal" },
  celda: { borderBottom: "1px solid #f4f4f5", padding: "6px 4px", verticalAlign: "top" },
  numero: { textAlign: "right", whiteSpace: "nowrap" },
  enlace: { color: "#1d4ed8", fontSize: "14px" },
  pie: { fontSize: "12px", lineHeight: "18px", color: "#71717a", margin: 0 },
} satisfies Record<string, CSSProperties>;

const COLUMNAS = ["Clave", "Descripción", "Unidad", "Existencia", "Mínimo", "Faltante"] as const;
const numerica = (i: number) => i >= 3;

export function ResumenDiario({ fecha, articulos, totalRenglones, renglones, urlReporte }: DatosResumen) {
  const faltan = totalRenglones - renglones.length;
  return (
    <Html lang="es">
      <Head />
      <Preview>{`${resumenDeN(articulos)} al ${fechaLarga(fecha)}`}</Preview>
      <Body style={estilos.cuerpo}>
        <Container style={estilos.contenedor}>
          <Heading as="h1" style={estilos.titulo}>
            Stock bajo mínimo
          </Heading>
          <Text style={estilos.texto}>
            Al {fechaLarga(fecha)}, {resumenDeN(articulos)} en al menos una bodega.
          </Text>

          {porBodega(renglones).map(([bodega, filas]) => (
            <Section key={bodega}>
              <Heading as="h2" style={estilos.bodega}>
                {bodega}
              </Heading>
              <table style={estilos.tabla} cellPadding={0} cellSpacing={0}>
                <thead>
                  <tr>
                    {COLUMNAS.map((c, i) => (
                      <th key={c} style={{ ...estilos.encabezado, ...(numerica(i) ? estilos.numero : {}) }}>
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filas.map((r) => (
                    <tr key={r.claveArticulo}>
                      <td style={{ ...estilos.celda, whiteSpace: "nowrap" }}>{r.claveArticulo}</td>
                      <td style={estilos.celda}>{r.descripcion}</td>
                      <td style={estilos.celda}>{r.unidad}</td>
                      <td style={{ ...estilos.celda, ...estilos.numero }}>{numero.format(r.existencia)}</td>
                      <td style={{ ...estilos.celda, ...estilos.numero }}>{numero.format(r.minimo)}</td>
                      <td style={{ ...estilos.celda, ...estilos.numero }}>{numero.format(r.faltante)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          ))}

          {faltan > 0 && <Text style={{ ...estilos.texto, marginTop: "16px" }}>{restantes(faltan)}</Text>}

          <Text style={{ ...estilos.texto, marginTop: "16px" }}>
            <Link href={urlReporte} style={estilos.enlace}>
              Ver el reporte de existencias bajo mínimo
            </Link>
          </Text>
          <Hr />
          <Text style={estilos.pie}>{COMO_DESACTIVAR}</Text>
        </Container>
      </Body>
    </Html>
  );
}

const enUnaLinea = (texto: string) => texto.replace(/\s+/g, " ").trim();

export function textoDelResumen({ fecha, articulos, totalRenglones, renglones, urlReporte }: DatosResumen): string {
  const lineas = ["Stock bajo mínimo", "", `Al ${fechaLarga(fecha)}, ${resumenDeN(articulos)} en al menos una bodega.`];
  for (const [bodega, filas] of porBodega(renglones)) {
    lineas.push("", enUnaLinea(bodega));
    for (const r of filas) {
      lineas.push(
        `- ${enUnaLinea(r.claveArticulo)} · ${enUnaLinea(r.descripcion)} (${enUnaLinea(r.unidad)}): ` +
          `existencia ${numero.format(r.existencia)}, mínimo ${numero.format(r.minimo)}, faltante ${numero.format(r.faltante)}`,
      );
    }
  }
  const faltan = totalRenglones - renglones.length;
  if (faltan > 0) lineas.push("", restantes(faltan));
  lineas.push("", `Ver el reporte de existencias bajo mínimo: ${urlReporte}`, "", COMO_DESACTIVAR, "");
  return lineas.join("\n");
}

export async function generarResumen(datos: DatosResumen): Promise<CorreoResumen> {
  return {
    asunto: asuntoDelResumen(datos.articulos),
    html: await render(<ResumenDiario {...datos} />),
    texto: textoDelResumen(datos),
  };
}
