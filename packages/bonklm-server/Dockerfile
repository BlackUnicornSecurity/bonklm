# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e
# BonkLM Guardrail Server — reproducible multi-stage release image.

ARG NODE_IMAGE=node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43

FROM ${NODE_IMAGE} AS builder

ARG RELEASE_VERSION
ENV CI=true

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /workspace

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/bonklm-server/package.json ./packages/bonklm-server/

# Refuse an unversioned build or an image/package version mismatch.
RUN PACKAGE_VERSION=$(node -p "require('./packages/bonklm-server/package.json').version") && \
  test -n "$RELEASE_VERSION" && \
  test "$PACKAGE_VERSION" = "$RELEASE_VERSION"

# Lifecycle scripts are not required to compile these TypeScript packages.
RUN pnpm install --frozen-lockfile --ignore-scripts \
  --filter @blackunicorn/bonklm-server... \
  --filter @blackunicorn/bonklm

COPY packages/core ./packages/core
COPY packages/bonklm-server ./packages/bonklm-server

RUN pnpm --filter @blackunicorn/bonklm build && \
  pnpm --filter @blackunicorn/bonklm-server build

# Recreate the filtered runtime graph from the committed lockfile and the
# already-populated content-addressed store. pnpm 9's legacy `deploy` command
# re-resolves injected workspace dependencies, so it is not used here.
RUN rm -rf node_modules packages/core/node_modules packages/bonklm-server/node_modules && \
  pnpm install --prod --offline --frozen-lockfile --ignore-scripts \
  --filter @blackunicorn/bonklm-server... \
  --filter @blackunicorn/bonklm

FROM ${NODE_IMAGE} AS runtime

ARG RELEASE_VERSION
ARG RELEASE_REVISION

RUN test -n "$RELEASE_REVISION"

# The supported-LTS, digest-pinned base already contains the patched OpenSSL
# runtime. Remove package managers unused by the service.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* && \
  rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/pnpm /usr/local/bin/pnpx \
  /usr/local/bin/yarn /usr/local/bin/yarnpkg

LABEL org.opencontainers.image.title="BonkLM Guardrail Server" \
  org.opencontainers.image.description="HMAC-authenticated HTTP guardrail server for BonkLM" \
  org.opencontainers.image.source="https://github.com/BlackUnicornSecurity/bonklm" \
  org.opencontainers.image.licenses="Apache-2.0" \
  org.opencontainers.image.version=$RELEASE_VERSION \
  org.opencontainers.image.revision=$RELEASE_REVISION

RUN addgroup -S bonklm && adduser -S bonklm -G bonklm

WORKDIR /app
COPY --from=builder /workspace/node_modules ./node_modules
COPY --from=builder /workspace/packages/core/package.json ./packages/core/package.json
COPY --from=builder /workspace/packages/core/LICENSE ./packages/core/LICENSE
COPY --from=builder /workspace/packages/core/README.md ./packages/core/README.md
COPY --from=builder /workspace/packages/core/dist ./packages/core/dist
COPY --from=builder /workspace/packages/core/node_modules ./packages/core/node_modules
COPY --from=builder /workspace/packages/bonklm-server/package.json ./packages/bonklm-server/package.json
COPY --from=builder /workspace/packages/bonklm-server/LICENSE ./packages/bonklm-server/LICENSE
COPY --from=builder /workspace/packages/bonklm-server/README.md ./packages/bonklm-server/README.md
COPY --from=builder /workspace/packages/bonklm-server/dist ./packages/bonklm-server/dist
COPY --from=builder /workspace/packages/bonklm-server/node_modules ./packages/bonklm-server/node_modules

WORKDIR /app/packages/bonklm-server

USER bonklm

ENV NODE_ENV=production
ENV BONKLM_PORT=4123
ENV BONKLM_HOST=0.0.0.0
ENV BONKLM_PRODUCTION_MODE=true

EXPOSE 4123

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:4123/healthz || exit 1

ENTRYPOINT ["node", "dist/bin/server.js"]
