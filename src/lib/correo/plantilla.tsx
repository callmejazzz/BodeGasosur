import type { CSSProperties } from "react";
import { Body, Container, Head, Heading, Hr, Html, Link, Preview, render, Text } from "react-email";
import type { RenglonBajoMinimo } from "@/lib/reportes/existencias";
import { cantidad } from "@/lib/utils";

export const TOPE_RENGLONES = 10;

export type DatosResumen = {
  articulos: number;
  renglones: RenglonBajoMinimo[];
  urlReporte: string;
};

export type CorreoResumen = { asunto: string; html: string; texto: string };

export const ASUNTO = "Tienes artículos con existencia debajo del mínimo";
const TITULO = "Existencia actual de los artículos";
const ENLACE = "Ver el reporte completo de existencias";
const COMO_DESACTIVAR = "Puedes desactivar estas notificaciones desde el apartado Preferencias de tu perfil en BodeGasosur";

const numero = new Intl.NumberFormat("es-MX");
const hayN = (articulos: number) => `Hay ${numero.format(articulos)} ${articulos === 1 ? "artículo" : "artículos"} por debajo del mínimo`;
const existenciaDe = (r: RenglonBajoMinimo) => `${cantidad(r.existencia)} de ${cantidad(r.minimo)} ${r.unidad}`;
const enUnaLinea = (texto: string) => texto.replace(/\s+/g, " ").trim();

export const LARGO_DESCRIPCION = 80;

export function recortarDescripcion(texto: string, largo = LARGO_DESCRIPCION): string {
  const limpio = enUnaLinea(texto);
  if (limpio.length <= largo) return limpio;
  const corte = limpio.slice(0, largo - 1);
  const espacio = corte.lastIndexOf(" ");
  return `${(espacio > largo / 2 ? corte.slice(0, espacio) : corte).trimEnd()}…`;
}

const ALTURA_LINEA = 18;
const ORILLA = "12px";
const BORDE = "1px solid #d4d4d8";

const estilos = {
  cuerpo: { backgroundColor: "#f4f4f5", fontFamily: "Arial, Helvetica, sans-serif", color: "#18181b", margin: 0 },
  contenedor: { backgroundColor: "#ffffff", maxWidth: "720px", margin: "0 auto", padding: "24px" },
  titulo: { fontSize: "20px", margin: "0 0 8px" },
  texto: { fontSize: "14px", lineHeight: "20px", margin: "0 0 16px" },
  tabla: { width: "100%", borderCollapse: "collapse", border: BORDE, fontSize: "13px", lineHeight: `${ALTURA_LINEA}px` },
  encabezado: { textAlign: "left", borderBottom: BORDE, padding: "8px", fontWeight: "bold", whiteSpace: "nowrap" },
  celda: { borderBottom: "1px solid #e4e4e7", padding: "8px", height: `${ALTURA_LINEA * 2}px`, verticalAlign: "middle" },
  dosLineas: { maxHeight: `${ALTURA_LINEA * 2}px`, overflow: "hidden" },
  sinCorte: { whiteSpace: "nowrap" },
  derecha: { textAlign: "right" },
  primera: { paddingLeft: ORILLA },
  ultima: { paddingRight: ORILLA },
  enlace: { color: "#1d4ed8", fontSize: "14px" },
  pie: { fontSize: "12px", lineHeight: "18px", color: "#71717a", margin: 0 },
} satisfies Record<string, CSSProperties>;

export function ResumenDiario({ articulos, renglones, urlReporte }: DatosResumen) {
  return (
    <Html lang="es">
      <Head />
      <Preview>{hayN(articulos)}</Preview>
      <Body style={estilos.cuerpo}>
        <Container style={estilos.contenedor}>
          <Heading as="h1" style={estilos.titulo}>
            {TITULO}
          </Heading>
          <Text style={estilos.texto}>{hayN(articulos)}</Text>

          <table style={estilos.tabla} cellPadding={0} cellSpacing={0}>
            <thead>
              <tr>
                <th style={{ ...estilos.encabezado, ...estilos.primera }}>CLAVE</th>
                <th style={{ ...estilos.encabezado, width: "100%" }}>DESCRIPCIÓN</th>
                <th style={estilos.encabezado}>BODEGA</th>
                <th style={{ ...estilos.encabezado, ...estilos.derecha, ...estilos.ultima }}>EXISTENCIA</th>
              </tr>
            </thead>
            <tbody>
              {renglones.map((r) => (
                <tr key={`${r.bodega}|${r.claveArticulo}`}>
                  <td style={{ ...estilos.celda, ...estilos.sinCorte, ...estilos.primera }}>{r.claveArticulo}</td>
                  <td style={estilos.celda}>
                    <div style={estilos.dosLineas}>{recortarDescripcion(r.descripcion)}</div>
                  </td>
                  <td style={{ ...estilos.celda, ...estilos.sinCorte }}>{r.bodega}</td>
                  <td style={{ ...estilos.celda, ...estilos.sinCorte, ...estilos.derecha, ...estilos.ultima }}>{existenciaDe(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <Text style={{ ...estilos.texto, marginTop: "16px" }}>
            <Link href={urlReporte} style={estilos.enlace}>
              {ENLACE}
            </Link>
          </Text>
          <Hr />
          <Text style={estilos.pie}>{COMO_DESACTIVAR}</Text>
        </Container>
      </Body>
    </Html>
  );
}

export function textoDelResumen({ articulos, renglones, urlReporte }: DatosResumen): string {
  const lineas = [TITULO, "", hayN(articulos), ""];
  for (const r of renglones) {
    lineas.push(`- ${enUnaLinea(r.claveArticulo)} · ${enUnaLinea(r.descripcion)} · ${enUnaLinea(r.bodega)}: ${enUnaLinea(existenciaDe(r))}`);
  }
  lineas.push("", `${ENLACE}: ${urlReporte}`, "", COMO_DESACTIVAR, "");
  return lineas.join("\n");
}

export async function generarResumen(datos: DatosResumen): Promise<CorreoResumen> {
  return {
    asunto: ASUNTO,
    html: await render(<ResumenDiario {...datos} />),
    texto: textoDelResumen(datos),
  };
}
