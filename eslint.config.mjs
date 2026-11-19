import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// El SQL de la alerta diaria (lib/correo/consultas) solo lo importan db.ts, que
// lo liga a la transacción de su origen, y las pruebas (contrato fase 9, §3.10).
const MENSAJE_SQL = "El SQL de la alerta solo lo liga db.ts: usa las funciones del cliente de escrituraDeSistema().";
// Con o sin extensión y desde cualquier carpeta; dentro de lib/correo, también como ./consultas.
const RUTAS_SQL = ["**/correo/consultas", "**/correo/consultas.*", "**/correo/consultas/**"];
const RUTAS_SQL_VECINAS = [...RUTAS_SQL, "./consultas", "./consultas.*", "./consultas/**"];
// no-restricted-imports no ve import() ni require(). Los selectores no admiten «/» en una expresión regular: va como \x2F.
const CARGA_SQL = String.raw`/(^|\x2F)correo\x2Fconsultas(\.[cm]?[jt]sx?|\x2F.*)?$/`;
const CARGA_SQL_VECINA = String.raw`/^\.\x2Fconsultas(\.[cm]?[jt]sx?|\x2F.*)?$/`;

const sinSqlDeLaAlerta = (rutas, cargas) => ({
  "no-restricted-imports": ["error", { patterns: [{ group: rutas, message: MENSAJE_SQL }] }],
  "no-restricted-syntax": [
    "error",
    ...cargas.flatMap((regex) => [
      { selector: `ImportExpression[source.value=${regex}]`, message: MENSAJE_SQL },
      { selector: `CallExpression[callee.name="require"][arguments.0.value=${regex}]`, message: MENSAJE_SQL },
    ]),
  ],
});
const PRUEBAS = "**/*.test.{ts,tsx,js,mjs,cjs}";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Skills de agentes instaladas con `npx skills add`: código de terceros que
    // no es del proyecto y que arrastra sus propias advertencias.
    ".agents/**",
    ".claude/**",
  ]),

  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    ignores: ["src/lib/db.ts", PRUEBAS],
    rules: sinSqlDeLaAlerta(RUTAS_SQL, [CARGA_SQL]),
  },
  {
    files: ["src/lib/correo/**"],
    ignores: [PRUEBAS],
    rules: sinSqlDeLaAlerta(RUTAS_SQL_VECINAS, [CARGA_SQL, CARGA_SQL_VECINA]),
  },

  // La puerta, cerrada también del lado del linter (01 §4.1).
  //
  // `lib/db.ts` ya no exporta el cliente, así que esto atrapa el rodeo: pedirle
  // uno nuevo a Prisma desde una pantalla. Sin la regla, la única defensa sería
  // acordarse — y una regla que se cumple recordándola se olvida.
  {
    files: ["src/app/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@prisma/client",
              importNames: ["PrismaClient"],
              message:
                "Las pantallas no hablan con Prisma. Lee con consultar() y escribe con accionProtegida(), de @/lib/db.",
            },
          ],
          patterns: [{ group: RUTAS_SQL, message: MENSAJE_SQL }],
        },
      ],
    },
  },
]);

export default eslintConfig;
