# ── Stage 1: TypeScript build ─────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

# Install deps first (layer-cached until package.json changes)
COPY package*.json ./
RUN npm ci

# Compile TypeScript
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build

# ── Stage 2: Production image ─────────────────────────────────────────────────
FROM node:20-slim

WORKDIR /app

# Production deps only
COPY package*.json ./
RUN npm ci --omit=dev

# Compiled JS from builder
COPY --from=builder /app/dist ./dist

# Entrypoint script loads /shared/addresses.env before starting the server
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENV NODE_ENV=production

EXPOSE 3000

ENTRYPOINT ["/docker-entrypoint.sh"]
