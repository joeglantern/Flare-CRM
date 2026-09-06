#!/bin/bash
# Nightly backup (docs/13 §3): logical DB dump + object storage + config → encrypted off-site restic repo.
# Required env: RESTIC_REPOSITORY, RESTIC_PASSWORD (or RESTIC_PASSWORD_FILE), AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
# (or B2_*), PGHOST/PGUSER/PGPASSWORD/PGDATABASE.
set -euo pipefail
STATE=/backup/state/last-status.json
START=$(date -u +%FT%TZ)
DUMP_DIR=/backup/db
mkdir -p "$DUMP_DIR"
STAMP=$(date -u +%F)

fail() {
  echo "{\"ok\":false,\"finishedAt\":\"$(date -u +%FT%TZ)\",\"error\":\"$1\"}" > "$STATE"
  echo "BACKUP FAILED: $1" >&2
  exit 1
}

echo "[$START] backup starting"
restic snapshots >/dev/null 2>&1 || restic init || fail "restic init failed"

# 1. consistent logical dump (custom format = compressed, parallel-restorable)
pg_dump -Fc --no-owner --no-privileges -f "$DUMP_DIR/crm-$STAMP.dump" || fail "pg_dump failed"
pg_dump --schema-only --no-owner -f "$DUMP_DIR/crm-schema-$STAMP.sql" || fail "schema dump failed"
# keep only the latest local dumps; history lives in restic
ls -1t "$DUMP_DIR"/crm-*.dump 2>/dev/null | tail -n +3 | xargs -r rm -f
ls -1t "$DUMP_DIR"/crm-schema-*.sql 2>/dev/null | tail -n +3 | xargs -r rm -f

# 2. snapshot: dumps + recordings/attachments + config + TLS certs
restic backup --tag nightly --host crm-vps \
  --exclude '/backup/seaweed/**/tmp*' \
  "$DUMP_DIR" /backup/seaweed /backup/config /backup/caddy || fail "restic backup failed"

# 3. retention (Sundays) + integrity spot-check
if [ "$(date +%u)" = "7" ]; then
  restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 12 --keep-yearly 3 --prune || fail "restic forget failed"
  restic check --read-data-subset=5% || fail "restic check failed"
fi

SNAP=$(restic snapshots --latest 1 --json | sed -n 's/.*"short_id":"\([^"]*\)".*/\1/p' | head -1)
SIZE=$(du -sh "$DUMP_DIR" | cut -f1)
echo "{\"ok\":true,\"startedAt\":\"$START\",\"finishedAt\":\"$(date -u +%FT%TZ)\",\"snapshot\":\"$SNAP\",\"dumpSize\":\"$SIZE\"}" > "$STATE"
echo "backup complete: snapshot $SNAP, dumps $SIZE"

# optional heartbeat ping (e.g. healthchecks.io / Uptime Kuma push URL)
if [ -n "${BACKUP_PING_URL:-}" ]; then curl -fsS -m 10 "$BACKUP_PING_URL" >/dev/null || true; fi
