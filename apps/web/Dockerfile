# syntax=docker/dockerfile:1.7
# Builds the Flare CRM web client to static files. In production the files are copied into the
# `web_dist` volume that Caddy serves (docs/12 §2); this image never runs a server.

FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
# The design system is a workspace dependency, so its own dependencies have to be installed here:
# without this the build compiles its sources with no node_modules beside them and fails on React.
COPY packages/ui/package.json packages/ui/
COPY packages/tsconfig/package.json packages/tsconfig/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
# Public origin of the deployment, for the absolute URLs link-preview crawlers need in index.html.
#   docker build --build-arg VITE_APP_URL=https://crm.example.com ...
ARG VITE_APP_URL=""
ENV VITE_APP_URL=$VITE_APP_URL
COPY packages ./packages
COPY docs/openapi.json ./docs/openapi.json
COPY apps/web ./apps/web
RUN pnpm --filter @crm/web openapi:types \
 && pnpm --filter @crm/web exec tsc --noEmit \
 && pnpm --filter @crm/web exec vite build

# ---- publisher: copies the build into the shared volume, then exits --------------------
FROM alpine:3.22 AS runtime
RUN addgroup -S app && adduser -S -G app app
COPY --from=build --chown=app:app /repo/apps/web/dist /srv/web
# Docker seeds an empty named volume from whatever the image holds at the mount path, ownership
# included. /out does not exist here otherwise, so the daemon creates it root owned and the
# unprivileged publisher below cannot write into it.
RUN install -d -o app -g app /out
USER app
# atomic-ish swap: stage then move, so Caddy never serves a half-copied tree
CMD ["sh", "-c", "rm -rf /out/.next && mkdir -p /out/.next && cp -R /srv/web/. /out/.next/ && find /out -mindepth 1 -maxdepth 1 ! -name .next -exec rm -rf {} + && cp -R /out/.next/. /out/ && rm -rf /out/.next && echo 'web assets published'"]
