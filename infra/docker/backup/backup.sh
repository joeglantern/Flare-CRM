#!/bin/bash
# Nightly backup (docs/13 §3).
#
# Two independent halves, in this order:
#   1. always: a logical dump, uploaded to the object store under backups/ so the application can
#      list and hand it back without ever running a command itself (docs/08 §N forbids that).
#   2. only when RESTIC_REPOSITORY is set: an encrypted off-site snapshot of the dump, the object
#      store and the config.
#
# Off-site used to be mandatory, so a deployment without a bucket produced no backups at all and
# failed loudly every night. A server-local snapshot is worth far more than nothing, and is what
# most deployments start with.
#
# Required: PGHOST/PGUSER/PGPASSWORD/PGDATABASE, S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY/S3_SECRET_KEY.
# Optional: RESTIC_REPOSITORY (+ RESTIC_PASSWORD and the bucket credentials), BACKUP_PING_URL.
set -uo pipefail
STATE=/backup/state/last-status.json
START=$(date -u +%FT%TZ)
DUMP_DIR=/backup/db
mkdir -p "$DUMP_DIR"
STAMP=$(date -u +%FT%H-%M-%SZ)
DUMP="$DUMP_DIR/crm-$STAMP.dump"

fail() {
  echo "{\"ok\":false,\"startedAt\":\"$START\",\"finishedAt\":\"$(date -u +%FT%TZ)\",\"error\":\"$1\"}" > "$STATE"
  echo "BACKUP FAILED: $1" >&2
  exit 1
}

echo "[$START] backup starting"

# ── 1. the dump ────────────────────────────────────────────────────────────────────────────
# Custom format: compressed, and what pg_restore expects. --no-owner/--no-privileges let it be
# restored into a database whose roles are named differently.
pg_dump -Fc --no-owner --no-privileges -f "$DUMP" || fail "pg_dump failed"
DUMP_BYTES=$(stat -c %s "$DUMP")

# Hand it to the object store, which is where the application looks. curl signs the request
# itself, so this needs no S3 client and no second set of credentials.
: "${S3_ENDPOINT:?S3_ENDPOINT is required}"
: "${S3_BUCKET:?S3_BUCKET is required}"
: "${S3_ACCESS_KEY:?S3_ACCESS_KEY is required}"
: "${S3_SECRET_KEY:?S3_SECRET_KEY is required}"
curl -sS --fail-with-body -X PUT \
  --aws-sigv4 "aws:amz:${S3_REGION:-us-east-1}:s3" \
  --user "$S3_ACCESS_KEY:$S3_SECRET_KEY" \
  -H 'Content-Type: application/octet-stream' \
  --upload-file "$DUMP" \
  "${S3_ENDPOINT%/}/$S3_BUCKET/backups/crm-$STAMP.dump" \
  || fail "uploading the dump to the object store failed"

# Keep a couple of copies on disk purely as a local fallback; the object store holds the series,
# and the application's nightly retention job trims it (it can already list and delete objects).
ls -1t "$DUMP_DIR"/crm-*.dump 2>/dev/null | tail -n +3 | xargs -r rm -f

# ── 2. off-site, when configured ───────────────────────────────────────────────────────────
OFFSITE="skipped"
if [ -n "${RESTIC_REPOSITORY:-}" ]; then
  restic snapshots >/dev/null 2>&1 || restic init || fail "restic init failed"
  restic backup --tag nightly --host crm-vps \
    --exclude '/backup/seaweed/**/tmp*' \
    "$DUMP_DIR" /backup/seaweed /backup/config /backup/caddy || fail "restic backup failed"
  if [ "$(date +%u)" = "7" ]; then
    restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 12 --keep-yearly 3 --prune \
      || fail "restic forget failed"
    restic check --read-data-subset=5% || fail "restic check failed"
  fi
  OFFSITE=$(restic snapshots --latest 1 --json | sed -n 's/.*"short_id":"\([^"]*\)".*/\1/p' | head -1)
else
  echo "RESTIC_REPOSITORY is not set: keeping the snapshot on this server only"
fi

echo "{\"ok\":true,\"startedAt\":\"$START\",\"finishedAt\":\"$(date -u +%FT%TZ)\",\"dump\":\"crm-$STAMP.dump\",\"dumpBytes\":$DUMP_BYTES,\"offsite\":\"$OFFSITE\"}" > "$STATE"
echo "backup complete: crm-$STAMP.dump ($DUMP_BYTES bytes), off-site $OFFSITE"

# optional heartbeat ping (e.g. healthchecks.io / Uptime Kuma push URL)
if [ -n "${BACKUP_PING_URL:-}" ]; then curl -fsS -m 10 "$BACKUP_PING_URL" >/dev/null || true; fi
