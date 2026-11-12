# syntax=docker/dockerfile:1

# La aplicación como contenedor: `next build` en modo standalone y
# `node server.js`. Las migraciones no corren aquí ni al arrancar
# la imagen nunca lleva la credencial del dueño.

FROM node:24-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS dependencias
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencias AS construccion
COPY . .
# Las NEXT_PUBLIC_* quedan incrustadas en el JavaScript del navegador.
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
ARG NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
ARG NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/
ARG NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/
# Cada build lleva su propio id, va solo en el build
ARG NEXT_DEPLOYMENT_ID
RUN npx prisma generate \
 && NEXT_DEPLOYMENT_ID="${NEXT_DEPLOYMENT_ID:-$(date -u +%Y%m%d%H%M%S)}" npm run build

FROM base AS app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=8080
COPY --from=construccion --chown=node:node /app/.next/standalone ./
COPY --from=construccion --chown=node:node /app/.next/static ./.next/static
COPY --from=construccion --chown=node:node /app/public ./public
COPY --chown=node:node certificates ./certificates
# Lo corre el proceso cron de Sevalla: node scripts/disparar-resumen.mjs
COPY --chown=node:node scripts/disparar-resumen.mjs ./scripts/disparar-resumen.mjs
USER node
EXPOSE 8080
CMD ["node", "server.js"]
