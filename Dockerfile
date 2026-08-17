# ==============================================================================
# REUNION FUND — DOCKERFILE (FAST & RELIABLE BUILD)
# ==============================================================================
FROM reunion-fund:stage AS base

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Reuse verified ARM64 node_modules from base staging image
COPY --from=base /app/node_modules ./node_modules
COPY package*.json ./

# Copy compiled application code and migrations
COPY server/dist ./server/dist
COPY server/src/db/migrations ./server/dist/db/migrations
COPY server/src/db/seeds ./server/dist/db/seeds
COPY client/dist ./client/dist

# Storage Volumes for persistent database and uploads
VOLUME ["/app/data", "/app/uploads"]

EXPOSE 3000
WORKDIR /

CMD ["/usr/local/bin/node", "/app/server/dist/index.js"]
