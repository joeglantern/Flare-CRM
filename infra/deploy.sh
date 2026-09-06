#!/bin/bash
# Deploy/upgrade on the VPS (docs/12 §5): pull image → run migrations (expand/contract safe) → restart app.
# Usage: IMAGE_TAG=<git-sha> ./deploy.sh      (run as the deploy user in /opt/crm)
set -euo pipefail
cd "$(dirname "$0")"
export IMAGE_TAG=${IMAGE_TAG:-latest}

[ -f .env ] || { echo ".env missing"; exit 1; }
[ -f secrets/postgres_password ] || { echo "secrets/postgres_password missing"; exit 1; }
[ -f secrets/valkey_password ] || { echo "secrets/valkey_password missing"; exit 1; }
[ -f seaweedfs/s3.json ] || { echo "seaweedfs/s3.json missing (see s3.json.example)"; exit 1; }

echo "== pulling ${IMAGE_TAG}"
docker compose pull api worker caddy postgres valkey seaweedfs
docker compose build backup

echo "== starting data services"
docker compose up -d postgres valkey seaweedfs
docker compose wait postgres 2>/dev/null || true

echo "== migrations (crm_migrate role)"
docker compose run --rm migrate

echo "== rolling app restart"
docker compose up -d api worker caddy backup
docker compose ps

echo "== health"
for i in $(seq 1 20); do
  if docker compose exec -T api curl -fsS http://127.0.0.1:4000/ready | grep -q '"ready"'; then
    echo "api ready"; exit 0
  fi
  sleep 3
done
echo "api did not become ready — check: docker compose logs --tail=200 api" >&2
exit 1
