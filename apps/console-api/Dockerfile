# syntax=docker/dockerfile:1.7
# The owner console backend (docs/21). Same shape as the CRM's image, one process instead of two.

FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && apk add --no-cache libc6-compat openssl
WORKDIR /repo

# ---- deps: install with the exact lockfile ---------------------------------------------
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/console-api/package.json apps/console-api/
COPY packages/shared/package.json packages/shared/
COPY packages/tsconfig/package.json packages/tsconfig/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# ---- build -----------------------------------------------------------------------------
FROM deps AS build
COPY packages ./packages
COPY apps/console-api ./apps/console-api
# The image builds the service, not its tests: the interop test reaches into apps/api on purpose
# (docs/20 §3), which is not in this context. CI typechecks the tests with the ordinary config.
# `generate` never opens a connection; the real URL arrives from the environment at runtime,
# where migrations actually need it.
ENV CONSOLE_DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
RUN pnpm --filter @crm/console-api prisma:generate \
 && pnpm --filter @crm/console-api exec tsc --noEmit -p tsconfig.build.json \
 && pnpm --filter @crm/console-api exec tsup \
 && pnpm --filter @crm/console-api --prod deploy /out --legacy

# ---- runtime ---------------------------------------------------------------------------
FROM node:24-alpine AS runtime
RUN apk add --no-cache openssl curl tini && addgroup -S app && adduser -S -G app app
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=app:app /out/node_modules ./node_modules
COPY --from=build --chown=app:app /out/package.json ./package.json
COPY --from=build --chown=app:app /repo/apps/console-api/dist ./dist
COPY --from=build --chown=app:app /repo/apps/console-api/prisma ./prisma
COPY --from=build --chown=app:app /repo/apps/console-api/prisma.config.ts ./prisma.config.ts
COPY --from=build --chown=app:app /repo/apps/console-api/src/generated ./src/generated
USER app
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD curl -fsS http://127.0.0.1:4100/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--enable-source-maps", "dist/entry/api.js"]
