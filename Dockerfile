# syntax=docker/dockerfile:1

# La aplicación como contenedor: `next build` en modo standalone y
# `node server.js`. Las migraciones no corren aquí ni al arrancar
# (docs/05 §8): la imagen nunca lleva la credencial del dueño.

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
# Sevalla no expone el commit al construir: sin valor, cada build lleva su
# propio id. Va solo en el build; definirlo distinto al arrancar lo pisaría.
ARG NEXT_DEPLOYMENT_ID
RUN npx prisma generate \
 && NEXT_DEPLOYMENT_ID="${NEXT_DEPLOYMENT_ID:-$(date -u +%Y%m%d%H%M%S)}" npm run build

FROM base AS app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=8080
COPY --from=construccion --chown=node:node /app/.next/standalone ./
COPY --from=construccion --chown=node:node /app/.next/static ./.next/static
COPY --from=construccion --chown=node:node /app/public ./public
# El CA de Supabase, para sslmode=verify-full (certificates/README.md).
COPY --chown=node:node certificates ./certificates
USER node
EXPOSE 8080
CMD ["node", "server.js"]
