# Vectores de prueba de Wycheproof

Vectores de verificación RSASSA-PKCS1-v1_5 con SHA-256 del proyecto Wycheproof
(C2SP), sin modificar. Los usa `prisma/sql/actor-verificable.test.ts` para probar
el verificador RS256 escrito en plpgsql (`seguridad.firma_rs256_valida`).

- Fuente: https://github.com/C2SP/wycheproof, carpeta `testvectors_v1/`
- Commit: `3fa63dd0344abb611f1fb1d77e119938603ea230`
- Descargados: 25 sep 2026
- Licencia: Apache 2.0, la del proyecto Wycheproof

| Archivo | Pruebas |
|---|---|
| `rsa_signature_2048_sha256_test.json` | 259 |
| `rsa_signature_3072_sha256_test.json` | 259 |
| `rsa_signature_4096_sha256_test.json` | 258 |

Los casos `acceptable` (DigestInfo sin el parámetro NULL) se esperan rechazados:
Clerk siempre firma con NULL y el verificador es estricto.
