# syntax=docker/dockerfile:1.7
# Builds the owner console client to static files. Caddy serves them from a shared volume, the
# same arrangement the CRM's client uses (docs/12 §2); this image never runs a server.

FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/console-web/package.json apps/console-web/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
COPY packages/tsconfig/package.json packages/tsconfig/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
COPY packages ./packages
COPY apps/console-web ./apps/console-web
RUN pnpm --filter @crm/console-web exec tsc --noEmit \
 && pnpm --filter @crm/console-web exec vite build

# ---- publisher: copies the build into the shared volume, then exits --------------------
FROM alpine:3.22 AS runtime
RUN addgroup -S app && adduser -S -G app app
COPY --from=build --chown=app:app /repo/apps/console-web/dist /srv/console
# Docker seeds an empty named volume from whatever the image holds at the mount path, ownership
# included; without this the daemon creates /out root owned and the publisher cannot write to it.
RUN install -d -o app -g app /out
USER app
# Stage then swap, so Caddy never serves a half-copied tree.
CMD ["sh", "-c", "rm -rf /out/.next && mkdir -p /out/.next && cp -R /srv/console/. /out/.next/ && find /out -mindepth 1 -maxdepth 1 ! -name .next -exec rm -rf {} + && cp -R /out/.next/. /out/ && rm -rf /out/.next && echo 'console assets published'"]
