# certificates

Aquí va el certificado raíz (CA) de Supabase, para que la conexión verifique al
servidor con `sslmode=verify-full`. Es público: se versiona.

1. Supabase → *Database* → *Settings* → *SSL Configuration* → **Download certificate**.
2. Guárdalo aquí como `supabase-ca.crt`.

El Dockerfile copia esta carpeta a `/app/certificates`, así que en el contenedor las URL de
conexión terminan en:

```text
?sslmode=verify-full&sslrootcert=/app/certificates/supabase-ca.crt
```

Desde una terminal (bootstrap, llaves, migraciones) se usa la ruta absoluta de este archivo
en tu máquina. Con `sslrootcert` en la URL, `pg` lee el archivo por su cuenta. El motor de
migraciones de Prisma ignora `verify-full` sin avisar y llama `sslcert` al CA:
`prisma.config.ts` le traduce la misma URL.
