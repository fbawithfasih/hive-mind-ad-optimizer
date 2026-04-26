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

# Install dumb-init for proper signal handling in containers
RUN apk add --no-cache dumb-init

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

# Non-root user for least privilege
RUN addgroup -S amaiop && adduser -S amaiop -G amaiop

# Copy backend prod deps + generated prisma client
COPY --from=backend-deps /app/node_modules ./node_modules
COPY --from=backend-deps /app/prisma ./prisma

# Copy source
COPY src/ ./src/
COPY package.json ./

# Copy built frontend (served as static files in production)
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Drop to non-root
USER amaiop

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/server.js"]
