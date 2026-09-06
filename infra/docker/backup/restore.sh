#!/bin/bash
# Restore drill / disaster recovery (docs/13 §5). Run inside the backup container:
#   docker compose run --rm backup restore.sh [snapshot-id|latest]
# Restores the newest dump into $PGDATABASE (dropping existing objects) and recordings into /backup/seaweed.
# Expect ~RTO 2h on a fresh VPS including provisioning.
set -euo pipefail
SNAP=${1:-latest}
WORK=/backup/restore
rm -rf "$WORK" && mkdir -p "$WORK"

echo "restoring snapshot $SNAP → $WORK"
restic restore "$SNAP" --target "$WORK" --include /backup/db --include /backup/config
DUMP=$(ls -1t "$WORK"/backup/db/crm-*.dump | head -1)
[ -n "$DUMP" ] || { echo "no dump found in snapshot"; exit 1; }

echo "restoring database from $DUMP (requires a superuser-capable PGUSER for --clean)"
pg_restore --clean --if-exists --no-owner --no-privileges -d "$PGDATABASE" "$DUMP"
echo "database restored"

if [ "${RESTORE_OBJECTS:-yes}" = "yes" ]; then
  echo "restoring object storage data (seaweedfs must be stopped: docker compose stop seaweedfs)"
  restic restore "$SNAP" --target / --include /backup/seaweed
  echo "objects restored; start seaweedfs again"
fi
echo "done. Next: docker compose up -d api worker; then run POST /api/v1/cti/reconcile to fill any call gap."
