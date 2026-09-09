import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

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
        },
      ],
    },
  },
]);

export default eslintConfig;
