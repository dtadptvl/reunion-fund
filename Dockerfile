# ==============================================================================
# REUNION FUND — MULTI-STAGE DOCKERFILE (ARM64 & AMD64)
# ==============================================================================

# --- Stage 1: Build Frontend Assets ---
FROM node:20-slim AS client-builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY client/ ./client/
RUN npm run build:client

# --- Stage 2: Build Backend Application ---
FROM node:20-slim AS server-builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY server/ ./server/
COPY tsconfig.json ./
RUN npm run build:server

# --- Stage 3: Production Runtime ---
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Install runtime dependencies for SQLite / build tools if needed
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled backend and frontend
COPY --from=server-builder /app/server/dist ./server/dist
COPY --from=server-builder /app/server/src/db/migrations ./server/dist/db/migrations
COPY --from=client-builder /app/client/dist ./client/dist

# Storage Volumes for persistent database and uploads
VOLUME ["/app/data", "/app/uploads"]

EXPOSE 3000

# Container Healthcheck
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/health/ready || exit 1

CMD ["node", "server/dist/index.js"]
