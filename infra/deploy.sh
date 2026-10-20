#!/bin/bash
# Deploy/upgrade on the VPS (docs/12 §5): pull image → run migrations (expand/contract safe) → restart app.
# Usage: IMAGE_TAG=<git-sha> ./deploy.sh      (run as the deploy user in /opt/crm)
#        BUILD_LOCALLY=1 REPO_DIR=<checkout> COMPOSE_DIR=<checkout>/infra/docker ./deploy.sh
#        builds the images on this server from the checkout instead of pulling them
#        PREBUILT=1 COMPOSE_DIR=... ./deploy.sh   uses images already loaded on this server
set -euo pipefail
cd "${COMPOSE_DIR:-$(dirname "$0")}"
export IMAGE_TAG=${IMAGE_TAG:-latest}

[ -f .env ] || { echo ".env missing"; exit 1; }
[ -f secrets/postgres_password ] || { echo "secrets/postgres_password missing"; exit 1; }
[ -f secrets/valkey_password ] || { echo "secrets/valkey_password missing"; exit 1; }
[ -f seaweedfs/s3.json ] || { echo "seaweedfs/s3.json missing (see s3.json.example)"; exit 1; }

if [ "${PREBUILT:-0}" = "1" ]; then
  # Images built on another machine and loaded here, for a host too small to build them: two
  # gigabytes of memory is not enough for the api's type check. From the build machine:
  #   docker save crm-api:local crm-web:local | gzip | ssh <host> 'gunzip | docker load'
  for image in "crm-api:${IMAGE_TAG}" "${WEB_IMAGE:-crm-web:local}"; do
    docker image inspect "$image" >/dev/null 2>&1 || {
      echo "$image is not loaded on this host" >&2
      exit 1
    }
  done
  docker compose pull caddy postgres valkey seaweedfs
  docker compose up web
elif [ "${BUILD_LOCALLY:-0}" = "1" ]; then
  REPO_DIR=${REPO_DIR:?REPO_DIR must point at the checkout to build from}
  echo "== building the images from $REPO_DIR"
  docker build -t "crm-api:${IMAGE_TAG}" -f "$REPO_DIR/apps/api/Dockerfile" "$REPO_DIR"
  docker compose pull caddy postgres valkey seaweedfs
  # The web bundle is built from the same checkout and published into the volume Caddy serves.
  docker compose build web
  docker compose up web
else
  echo "== pulling ${IMAGE_TAG}"
  docker compose pull api worker caddy postgres valkey seaweedfs
fi
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
