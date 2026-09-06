# 13 — Backup, Recovery & Data Durability

Requirement: "the data should not be lost" and spec §8 "daily automated backups of database
and recordings". Targets: **RPO ≤ 24 h** (nightly) with **optional RPO ≤ 15 min** via WAL
archiving, **RTO ≤ 2 h** on a fresh VPS.

## 1. Where data lives

| Data                                                 | Store                          | Volume              | Backed up                                                                   |
| ---------------------------------------------------- | ------------------------------ | ------------------- | --------------------------------------------------------------------------- |
| All CRM records, users, audit                        | PostgreSQL                     | `pg_data`           | yes (logical dump nightly; optional WAL)                                    |
| Recordings, attachments, avatars, exports            | SeaweedFS (or external S3)     | `seaweed_data`      | yes (restic of the data dir **or** bucket sync)                             |
| Sessions cache, queues, live call state, rate limits | Valkey                         | `valkey_data` (AOF) | no — ephemeral/re-derivable; AOF only for restart continuity of queued jobs |
| TLS certs                                            | Caddy                          | `caddy_data`        | yes (small; avoids LE rate limits on restore)                               |
| Configuration                                        | `/opt/crm/.env`, compose files | host                | yes (encrypted in the same restic repo)                                     |

## 2. Durability settings (prevent loss before backups)

- PostgreSQL: `fsync=on`, `synchronous_commit=on`, `wal_level=replica`, `full_page_writes=on` (defaults; never disabled), `shm_size` set, checksums enabled at initdb (`POSTGRES_INITDB_ARGS="--data-checksums"`).
- Valkey: `appendonly yes`, `appendfsync everysec`, `maxmemory-policy noeviction` (BullMQ and sessions must never be evicted).
- Docker named volumes on the VPS's persistent disk; **never** bind-mount into `/tmp`; volumes labeled `com.crm.persistent=true`; `infra/compose.sh` wrapper refuses `down -v`/`rm -v` in production.
- Application: soft deletes on business entities; append-only audit; idempotent upserts so replays never duplicate.
- Provider snapshots (if available) enabled daily as an extra, independent layer.

## 3. Backup job (`infra/docker/backup/`)

Container `backup` runs a cron entry at 02:30 server time:

```
1. pg_dump -Fc --no-owner -h postgres -U crm_backup crm > /backup/db/crm-$(date +%F).dump   (custom format, compressed, consistent snapshot)
2. pg_dump --schema-only → crm-schema-$(date).sql (human-readable safety net)
3. restic backup /backup/db /seaweed_data(ro) /opt/crm/config(ro) /caddy_data(ro) \
     --tag nightly --host crm-vps   → repository s3:https://<offsite-endpoint>/<bucket>/crm  (RESTIC_PASSWORD from secret file)
   (if using external S3 for objects instead of SeaweedFS: `rclone sync s3-primary:crm s3-offsite:crm-objects` instead of backing up seaweed_data)
4. restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 12 --keep-yearly 3 --prune   (weekly on Sundays)
5. restic check --read-data-subset=5%   (weekly)
6. Write status to /backup/last-status.json { finishedAt, snapshotId, sizes, ok }; api /ready exposes `backup.lastOkAt`; alert if > 26 h.
```

- Off-site target is a **different provider/region** than the VPS (e.g. Hetzner Object Storage / Backblaze B2 / Wasabi). Credentials scoped to that bucket only, with object lock/versioning enabled so a compromised VPS cannot delete history (restic `--no-lock` + bucket policy denying `DeleteObject` for the backup key, prune done by a separate key from an operator machine).
- restic encrypts client-side; the repository password is stored in the team password manager and **not** only on the VPS.

## 4. Optional continuous protection (RPO ≤ 15 min)

Enable `pgBackRest` (or WAL-G) sidecar with `archive_mode=on`, `archive_command` → same off-site bucket, full backup weekly + differential daily + WAL every ≤ 15 min. Recommended when the client's call volume makes losing a day of call logs unacceptable. The nightly logical dump stays as a portable fallback.

## 5. Restore drill (monthly, on a throwaway VPS or local Docker)

```
1. Provision host (bootstrap.sh) → copy .env/compose from restic: restic restore latest --include /opt/crm/config --target /
2. docker compose up -d postgres valkey seaweedfs
3. restic restore latest --include /backup/db --target /tmp/r
   pg_restore -h postgres -U postgres -d crm --clean --if-exists --no-owner /tmp/r/backup/db/crm-<date>.dump
4. restic restore latest --include /seaweed_data --target /   (or rclone sync offsite → primary bucket)
5. docker compose run --rm migrate      # no-op if versions match
6. docker compose up -d api worker caddy
7. Verify: sign in, open a contact timeline, play a recording, check /ready, run CTI reconcile (fills any gap since the backup).
8. Record drill result (date, duration, issues) in docs/ops/restore-drills.md.
```

A backup that has not been restored is not a backup — the drill is part of the definition of done for P1.

## 6. Retention & legal holds

- Recordings: `Setting.recording.retentionDays` (default 365) → retention job deletes objects + sets `calls.recording_status='none'`, audit row. Admin can place a **legal hold** on a contact (`contacts.legal_hold=true`, P2) which exempts its data from purge.
- Soft-deleted rows: purged after 90 days.
- Backups themselves follow the restic policy (7d/4w/12m/3y). Erasure requests note that backups age out per policy (documented for DPA compliance).

## 7. Failure scenarios covered

| Scenario                             | Recovery                                                                                     |
| ------------------------------------ | -------------------------------------------------------------------------------------------- |
| Accidental record deletion by a user | soft delete → restore in UI (manager) within 90 days                                         |
| Bad deploy / migration               | rollback image; migrations are expand/contract; restore from last nightly if data corruption |
| Disk failure / VPS loss              | new VPS + restore drill (RTO ≤ 2 h)                                                          |
| Ransomware on VPS                    | off-site bucket has versioning + delete-denied key; restic repo password off-box             |
| PBX event gap                        | CTI reconciliation from PBX CDR (independent copy of call history on the PBX)                |
| Recording missing locally            | re-download from PBX if still present (`recording/search` by file name)                      |
