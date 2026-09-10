#!/bin/bash
# Deploy or upgrade the owner console (docs/21). Run as the deploy user in /opt/flare-console.
#   IMAGE_TAG=<git-sha> ./deploy.sh
#
# The console holds every customer's plan and an append-only record of who changed it. Never run
# `docker compose down -v` here.
#
# On a host that also runs a customer stack, pass --shared-caddy: that stack's Caddy serves the
# console as an extra site, so this one has no web server of its own (docs/21 §7).
set -euo pipefail
cd "$(dirname "$0")"
# The shell wins, then .env, then latest. Compose gives the shell precedence over the file, so
# exporting a default here unconditionally would quietly ignore what .env says.
if [ -z "${IMAGE_TAG:-}" ] && [ -f .env ]; then
  IMAGE_TAG=$(sed -n 's/^IMAGE_TAG=//p' .env | tail -1)
fi
export IMAGE_TAG=${IMAGE_TAG:-latest}

COMPOSE=(docker compose)
SHARED_CADDY=0
if [ "${1:-}" = "--shared-caddy" ]; then
  SHARED_CADDY=1
  COMPOSE=(docker compose -f compose.yml -f same-host/console.yml)
fi

[ -f .env ] || {
  echo ".env missing (copy .env.example and fill it in)" >&2
  exit 1
}
for secret in postgres_password valkey_password pgpass; do
  [ -f "secrets/$secret" ] || {
    echo "secrets/$secret missing" >&2
    exit 1
  }
done

# A console without its signing key can sign nothing, and every stack would keep whatever it holds.
grep -q '^CONSOLE_SIGNING_KEY=.\+' .env || {
  echo "CONSOLE_SIGNING_KEY is empty in .env" >&2
  exit 1
}

echo "== images"
if [ "${BUILD_LOCALLY:-0}" = "1" ]; then
  # Small hosts build here rather than pulling a registry they have no credentials for.
  "${COMPOSE[@]}" build web
  docker build -f ../../apps/console-api/Dockerfile -t "${CONSOLE_IMAGE:-crm-console-api}:${IMAGE_TAG}" ../..
else
  "${COMPOSE[@]}" pull api postgres valkey web
fi

echo "== starting data services"
"${COMPOSE[@]}" up -d postgres valkey

echo "== migrations"
"${COMPOSE[@]}" run --rm migrate

echo "== seed (starting plan and provider contact; idempotent)"
"${COMPOSE[@]}" run --rm seed

echo "== publishing the client and starting the console"
"${COMPOSE[@]}" up -d web
if [ "$SHARED_CADDY" = "1" ]; then
  "${COMPOSE[@]}" up -d api backup
  echo "   (no Caddy here: the customer stack's Caddy serves this console)"
else
  "${COMPOSE[@]}" up -d api caddy backup
fi
"${COMPOSE[@]}" ps

echo "== health"
for _ in $(seq 1 20); do
  if "${COMPOSE[@]}" exec -T api curl -fsS http://127.0.0.1:4100/ready | grep -q '"ready"'; then
    echo "console ready"
    echo
    echo "Signing key fingerprint (customers trust this key):"
    "${COMPOSE[@]}" exec -T api curl -fsS http://127.0.0.1:4100/ready |
      sed -n 's/.*"keyId":"\([0-9a-f]*\)".*/  \1/p'
    exit 0
  fi
  sleep 3
done
echo "console did not become ready — check: docker compose logs --tail=200 api" >&2
exit 1
