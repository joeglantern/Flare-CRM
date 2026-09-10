#!/bin/bash
# Deploy or upgrade the owner console (docs/21). Run as the deploy user in /opt/flare-console.
#   IMAGE_TAG=<git-sha> ./deploy.sh
#
# The console holds every customer's plan and an append-only record of who changed it. Never run
# `docker compose down -v` here.
set -euo pipefail
cd "$(dirname "$0")"
export IMAGE_TAG=${IMAGE_TAG:-latest}

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

echo "== pulling ${IMAGE_TAG}"
docker compose pull api caddy postgres valkey web

echo "== starting data services"
docker compose up -d postgres valkey

echo "== migrations"
docker compose run --rm migrate

echo "== seed (starting plan and provider contact; idempotent)"
docker compose run --rm seed

echo "== publishing the client and starting the console"
docker compose up -d web
docker compose up -d api caddy backup
docker compose ps

echo "== health"
for _ in $(seq 1 20); do
  if docker compose exec -T api curl -fsS http://127.0.0.1:4100/ready | grep -q '"ready"'; then
    echo "console ready"
    echo
    echo "Signing key fingerprint (customers trust this key):"
    docker compose exec -T api curl -fsS http://127.0.0.1:4100/ready |
      sed -n 's/.*"keyId":"\([0-9a-f]*\)".*/  \1/p'
    exit 0
  fi
  sleep 3
done
echo "console did not become ready — check: docker compose logs --tail=200 api" >&2
exit 1
