# ============================================================================
# Stage 1 — frontend build
# ============================================================================
FROM node:22-alpine AS frontend-builder

# Vite inlines import.meta.env.VITE_* at BUILD time, so this has to be present
# here — a runtime service variable is far too late and the bundle simply ships
# without a DSN. Railway does not inject service variables into Dockerfile
# builds (Docker isolates the build from the host by design); it passes them as
# build args, and a stage only receives one it declares. Without this ARG,
# setting VITE_SENTRY_DSN in Railway looks configured and does nothing.
ARG VITE_SENTRY_DSN=""
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci --no-audit --prefer-offline

COPY frontend/ ./
# Vite/Node 22 symlink bug workaround
RUN node node_modules/vite/dist/node/cli.js build

# ============================================================================
# Stage 2 — backend dependencies (prod only)
# ============================================================================
FROM node:22-alpine AS backend-deps

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev --no-audit --prefer-offline

COPY prisma/ ./prisma/
RUN npx prisma generate

# ============================================================================
# Stage 3 — final runtime image
# ============================================================================
FROM node:22-alpine AS runner

RUN apk add --no-cache dumb-init

ENV NODE_ENV=production
ENV PORT=8080
ENV BUILD_VERSION=3

WORKDIR /app

# Copy backend prod deps + generated prisma client
COPY --from=backend-deps /app/node_modules ./node_modules
COPY --from=backend-deps /app/prisma ./prisma

# Copy source
COPY src/ ./src/
COPY data/ ./data/
COPY package.json ./
# Loaded by `node --import ./instrument.mjs` (railway.toml startCommand,
# package.json start). Without it in the image the process exits immediately
# with ERR_MODULE_NOT_FOUND and every deploy fails at the healthcheck.
COPY instrument.mjs ./

# Copy built frontend
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

EXPOSE 8080

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/server.js"]
