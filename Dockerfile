# ============================================================================
# Stage 1 — frontend build
# ============================================================================
FROM node:22-alpine AS frontend-builder

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

# Copy built frontend
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

EXPOSE 8080

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/server.js"]
