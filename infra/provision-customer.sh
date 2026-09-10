#!/bin/bash
# Stands a customer's CRM up on a bootstrapped VPS (docs/12 §4, docs/21).
#
# Run this on the customer's own server, as a user who can use docker, after vps/bootstrap.sh has
# prepared the machine. It writes /opt/crm, generates every password, registers the stack with the
# owner console using the credentials the console handed out, and deploys.
#
# Nothing it generates is printed. The passwords exist in /opt/crm/.env and /opt/crm/secrets and
# nowhere else, which is why /opt/crm is backed up along with the data (docs/13).
#
#   sudo ./provision-customer.sh \
#     --slug acme --domain acme.raniafrica.co.ke \
#     [--extra-domains crm.acme.co.ke] \
#     --console-url https://console.raniafrica.co.ke \
#     --stack-id stk_... --stack-secret ... --console-public-key MCowBQ... \
#     --acme-email ops@raniafrica.co.ke --admin-email jane@acme.co.ke \
#     [--image-tag <git-sha>] [--repo-owner OWNER] [--dir /opt/crm]
set -euo pipefail

SLUG=""
DOMAIN=""
EXTRA_DOMAINS=""
CONSOLE_URL=""
STACK_ID=""
STACK_SECRET=""
CONSOLE_PUBLIC_KEY=""
ACME_EMAIL=""
ADMIN_EMAIL=""
ADMIN_NAME="Administrator"
IMAGE_TAG="latest"
REPO_OWNER="${REPO_OWNER:-OWNER}"
TARGET_DIR="/opt/crm"

while [ $# -gt 0 ]; do
  case "$1" in
    --slug) SLUG=$2; shift 2 ;;
    --domain) DOMAIN=$2; shift 2 ;;
    --extra-domains) EXTRA_DOMAINS=$2; shift 2 ;;
    --console-url) CONSOLE_URL=$2; shift 2 ;;
    --stack-id) STACK_ID=$2; shift 2 ;;
    --stack-secret) STACK_SECRET=$2; shift 2 ;;
    --console-public-key) CONSOLE_PUBLIC_KEY=$2; shift 2 ;;
    --acme-email) ACME_EMAIL=$2; shift 2 ;;
    --admin-email) ADMIN_EMAIL=$2; shift 2 ;;
    --admin-name) ADMIN_NAME=$2; shift 2 ;;
    --image-tag) IMAGE_TAG=$2; shift 2 ;;
    --repo-owner) REPO_OWNER=$2; shift 2 ;;
    --dir) TARGET_DIR=$2; shift 2 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

missing=""
for pair in "slug:$SLUG" "domain:$DOMAIN" "acme-email:$ACME_EMAIL" "admin-email:$ADMIN_EMAIL"; do
  [ -n "${pair#*:}" ] || missing="$missing --${pair%%:*}"
done
[ -z "$missing" ] || {
  echo "missing required option(s):$missing" >&2
  exit 2
}

# The console block is all or nothing: a stack with half of it set refuses to start, on purpose.
console_args=0
for value in "$CONSOLE_URL" "$STACK_ID" "$STACK_SECRET" "$CONSOLE_PUBLIC_KEY"; do
  [ -z "$value" ] || console_args=$((console_args + 1))
done
if [ "$console_args" -ne 0 ] && [ "$console_args" -ne 4 ]; then
  echo "give all four of --console-url --stack-id --stack-secret --console-public-key, or none" >&2
  exit 2
fi

command -v docker >/dev/null || {
  echo "docker is not installed; run vps/bootstrap.sh first" >&2
  exit 1
}

REPO_DIR=$(cd "$(dirname "$0")/.." && pwd)
secret() { openssl rand -base64 36 | tr -d '\n/+=' | cut -c1-32; }

echo "== preparing $TARGET_DIR"
install -d -m 750 "$TARGET_DIR" "$TARGET_DIR/secrets"
cp -R "$REPO_DIR/infra/docker/." "$TARGET_DIR/"
cp "$REPO_DIR/infra/deploy.sh" "$TARGET_DIR/deploy.sh"
chmod +x "$TARGET_DIR/deploy.sh"

if [ -f "$TARGET_DIR/.env" ]; then
  echo "$TARGET_DIR/.env already exists; leaving it alone and deploying with it"
else
  echo "== generating secrets"
  PG_PASSWORD=$(secret)
  APP_PASSWORD=$(secret)
  MIGRATE_PASSWORD=$(secret)
  BACKUP_PASSWORD=$(secret)
  VALKEY_PASSWORD=$(secret)
  S3_KEY=$(secret)
  S3_SECRET=$(secret)

  umask 077
  printf '%s' "$PG_PASSWORD" > "$TARGET_DIR/secrets/postgres_password"
  printf '%s' "$VALKEY_PASSWORD" > "$TARGET_DIR/secrets/valkey_password"

  # Caddy serves the customer's own domain from the same site block; an empty value is the
  # ordinary case (docs/12 §1). Compose trims a leading space out of a .env value, so the
  # separators live in the Caddyfile rather than at the front of these.
  extra_sites=""
  extra_csp=""
  origins=""
  if [ -n "$EXTRA_DOMAINS" ]; then
    for host in $(echo "$EXTRA_DOMAINS" | tr ',' ' '); do
      extra_sites="$extra_sites, $host"
      extra_csp="${extra_csp:+$extra_csp }wss://$host https://$host"
      origins="${origins:+$origins,}https://$host"
    done
  fi

  cat > "$TARGET_DIR/.env" <<ENV
# Written by provision-customer.sh for $SLUG. Contains every password this stack uses.
NODE_ENV=production
APP_URL=https://$DOMAIN
APP_EXTRA_ORIGINS=$origins
CRM_DOMAIN=$DOMAIN
CRM_EXTRA_SITES=$extra_sites
CRM_EXTRA_CSP=$extra_csp
ACME_EMAIL=$ACME_EMAIL

API_HOST=0.0.0.0
API_PORT=4000
LOG_LEVEL=info
TRUST_PROXY_HOPS=1

AUTH_SECRET=$(openssl rand -base64 48 | tr -d '\n')
SECRETS_KEY=$(openssl rand -hex 32)

DATABASE_URL=postgresql://crm_app:$APP_PASSWORD@postgres:5432/crm?schema=public
DATABASE_URL_MIGRATE=postgresql://crm_migrate:$MIGRATE_PASSWORD@postgres:5432/crm?schema=public
VALKEY_URL=redis://:$VALKEY_PASSWORD@valkey:6379/0
CRM_APP_PASSWORD=$APP_PASSWORD
CRM_MIGRATE_PASSWORD=$MIGRATE_PASSWORD
CRM_BACKUP_PASSWORD=$BACKUP_PASSWORD

S3_ENDPOINT=http://seaweedfs:8333
S3_REGION=us-east-1
S3_BUCKET=crm
S3_ACCESS_KEY=$S3_KEY
S3_SECRET_KEY=$S3_SECRET
S3_FORCE_PATH_STYLE=true

SMTP_URL=smtp://127.0.0.1:25
MAIL_FROM="Flare CRM <no-reply@$DOMAIN>"

YEASTAR_ENABLED=false
WHATSAPP_ENABLED=false
OPENAPI_ENABLED=false
METRICS_ENABLED=false

FIRST_ADMIN_EMAIL=$ADMIN_EMAIL
FIRST_ADMIN_NAME=$ADMIN_NAME

IMAGE=ghcr.io/$REPO_OWNER/crm-api
WEB_IMAGE=ghcr.io/$REPO_OWNER/crm-web:$IMAGE_TAG
IMAGE_TAG=$IMAGE_TAG
ENV

  if [ "$console_args" -eq 4 ]; then
    cat >> "$TARGET_DIR/.env" <<ENV

# Owner console (docs/21). The worker dials out to it; nothing reaches in.
CONSOLE_URL=$CONSOLE_URL
CONSOLE_STACK_ID=$STACK_ID
CONSOLE_STACK_SECRET=$STACK_SECRET
CONSOLE_PUBLIC_KEY=$CONSOLE_PUBLIC_KEY
ENV
  else
    echo "no console credentials given: this stack runs standalone, with every feature on"
  fi

  # The object store's own credentials file has to match what the api is told to use.
  if [ -f "$TARGET_DIR/seaweedfs/s3.json.example" ]; then
    sed -e "s|REPLACE_WITH_S3_ACCESS_KEY|$S3_KEY|" -e "s|REPLACE_WITH_S3_SECRET_KEY|$S3_SECRET|" \
      "$TARGET_DIR/seaweedfs/s3.json.example" > "$TARGET_DIR/seaweedfs/s3.json"
  fi
  chmod 600 "$TARGET_DIR/.env"
fi

echo "== deploying"
cd "$TARGET_DIR"
IMAGE_TAG="$IMAGE_TAG" ./deploy.sh

cat <<DONE

$SLUG is up at https://$DOMAIN
  - the first administrator ($ADMIN_EMAIL) has been emailed a link to set their password
  - passwords live in $TARGET_DIR/.env and $TARGET_DIR/secrets, and nowhere else
$([ "$console_args" -eq 4 ] && echo "  - the console should show this stack as live within half a minute")
$([ -n "$EXTRA_DOMAINS" ] && echo "  - $EXTRA_DOMAINS will get a certificate once its DNS points here")
DONE
