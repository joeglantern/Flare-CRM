# syntax=docker/dockerfile:1.7
# Multi-stage build for the CRM api/worker (docs/12 §2). Same image runs both processes.

FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && apk add --no-cache libc6-compat openssl
WORKDIR /repo

# ---- deps: install with the exact lockfile ---------------------------------------------
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/tsconfig/package.json packages/tsconfig/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# ---- build -----------------------------------------------------------------------------
FROM deps AS build
COPY packages ./packages
COPY apps/api ./apps/api
# prisma.config.ts resolves the datasource URL eagerly, but `generate` never opens a connection.
# A placeholder lets the client be generated without a database at build time; the real URL is
# supplied by the environment at runtime, where migrations actually need it.
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
RUN pnpm --filter @crm/api prisma:generate \
 && pnpm --filter @crm/api exec tsc --noEmit \
 && pnpm --filter @crm/api exec tsup \
 && pnpm --filter @crm/api --prod deploy /out --legacy

# ---- runtime ---------------------------------------------------------------------------
FROM node:24-alpine AS runtime
# What this image was built from, reported to the owner console in every heartbeat so the fleet
# screen can say which stack is behind (docs/21):
#   docker build --build-arg APP_VERSION=$(git rev-parse --short HEAD) ...
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
RUN apk add --no-cache openssl curl tini && addgroup -S app && adduser -S -G app app
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=app:app /out/node_modules ./node_modules
COPY --from=build --chown=app:app /out/package.json ./package.json
COPY --from=build --chown=app:app /repo/apps/api/dist ./dist
COPY --from=build --chown=app:app /repo/apps/api/prisma ./prisma
COPY --from=build --chown=app:app /repo/apps/api/prisma.config.ts ./prisma.config.ts
COPY --from=build --chown=app:app /repo/apps/api/src/generated ./src/generated
USER app
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD curl -fsS http://127.0.0.1:4000/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "if [ \"$APP_MODE\" = \"worker\" ]; then exec node --enable-source-maps dist/entry/worker.js; else exec node --enable-source-maps dist/entry/api.js; fi"]
