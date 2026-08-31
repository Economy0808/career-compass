# Next.js 14 (App Router) frontend for Cloud Run.
#
# Two stages: build with full deps (next.config.mjs imports a devDependency,
# @opennextjs/cloudflare, at module scope - omitting dev deps breaks the build),
# then ship only Next's "standalone" bundle so the runtime image stays small.
#
# NEXT_PUBLIC_* values are inlined into the client bundle at BUILD time, so they
# must arrive as build args, not runtime env. They are public by design.
# (ASCII only - repo convention for config files on Windows.)

FROM node:20-slim AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

ARG NEXT_PUBLIC_API_BASE_URL=""
ARG NEXT_PUBLIC_FIREBASE_API_KEY=""
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=""
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID=""
ARG NEXT_PUBLIC_FIREBASE_APP_ID=""
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
    NEXT_PUBLIC_FIREBASE_API_KEY=$NEXT_PUBLIC_FIREBASE_API_KEY \
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN \
    NEXT_PUBLIC_FIREBASE_PROJECT_ID=$NEXT_PUBLIC_FIREBASE_PROJECT_ID \
    NEXT_PUBLIC_FIREBASE_APP_ID=$NEXT_PUBLIC_FIREBASE_APP_ID \
    NEXT_TELEMETRY_DISABLED=1

RUN npm run build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1

# standalone output already contains a minimal node_modules and server.js.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Cloud Run injects $PORT; Next's standalone server reads PORT/HOSTNAME.
ENV HOSTNAME=0.0.0.0
CMD ["sh", "-c", "PORT=${PORT:-8080} node server.js"]
