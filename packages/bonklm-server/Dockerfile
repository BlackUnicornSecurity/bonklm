# BonkLM Guardrail Server — Dockerfile
# =====================================
# Multi-stage build: pnpm workspace builder → minimal runtime image.
#
# Build: docker build -t blackunicorn/bonklm-server:0.5.0 -f packages/bonklm-server/Dockerfile .
# Run:   docker run -p 4123:4123 -e BONKLM_HMAC_SECRET=... blackunicorn/bonklm-server:0.5.0

# ─── Stage 1: builder ────────────────────────────────────────────────
FROM node:20-alpine AS builder

# pnpm via corepack (no global install needed).
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /workspace

# Copy workspace manifest + lockfile + individual package manifests.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY tsconfig.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/bonklm-server/package.json ./packages/bonklm-server/

# Install only the production deps + their transitive dev-deps needed
# to build (TypeScript, fastify).
RUN pnpm install --frozen-lockfile --filter @blackunicorn/bonklm-server... --filter @blackunicorn/bonklm

# Copy source + tsconfig for both core + server.
COPY packages/core ./packages/core
COPY packages/bonklm-server ./packages/bonklm-server

# Build core first (server depends on it).
RUN cd packages/core && pnpm run build
RUN cd packages/bonklm-server && pnpm run build

# Prune dev deps for the runtime stage.
RUN pnpm prune --prod --filter @blackunicorn/bonklm-server

# ─── Stage 2: runtime ────────────────────────────────────────────────
FROM node:20-alpine AS runtime

# Non-root user for the runtime.
RUN addgroup -S bonklm && adduser -S bonklm -G bonklm

WORKDIR /app

# Copy ONLY the production runtime artifacts.
COPY --from=builder --chown=bonklm:bonklm /workspace/node_modules ./node_modules
COPY --from=builder --chown=bonklm:bonklm /workspace/packages/core/dist ./packages/core/dist
COPY --from=builder --chown=bonklm:bonklm /workspace/packages/core/package.json ./packages/core/
COPY --from=builder --chown=bonklm:bonklm /workspace/packages/bonklm-server/dist ./packages/bonklm-server/dist
COPY --from=builder --chown=bonklm:bonklm /workspace/packages/bonklm-server/package.json ./packages/bonklm-server/

USER bonklm

ENV NODE_ENV=production
ENV BONKLM_PORT=4123
ENV BONKLM_HOST=0.0.0.0
ENV BONKLM_PRODUCTION_MODE=true

# BONKLM_HMAC_SECRET MUST be provided at runtime — no default.
# Generate via: openssl rand -base64 32

EXPOSE 4123

# Healthcheck probes /healthz (no HMAC required on this endpoint).
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:4123/healthz || exit 1

ENTRYPOINT ["node", "packages/bonklm-server/dist/bin/server.js"]
