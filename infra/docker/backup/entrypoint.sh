#!/bin/sh
# Installs the cron schedule and runs crond in the foreground. Logs go to docker logs.
set -eu
: "${BACKUP_CRON:=30 2 * * *}"
echo "${BACKUP_CRON} /usr/local/bin/backup.sh >> /proc/1/fd/1 2>&1" > /etc/crontabs/root
echo "backup schedule: ${BACKUP_CRON}"
# run once at boot if there has never been a successful backup (fresh install safety net)
if [ ! -f /backup/state/last-status.json ]; then
  /usr/local/bin/backup.sh || true
fi
exec crond -f -l 8
