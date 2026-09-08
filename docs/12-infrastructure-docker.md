# 12 — Infrastructure, Docker & Operations

Target: one Linux VPS (recommended minimum 4 vCPU / 8 GB RAM / 160 GB NVMe for ≤ 100 agents;
recordings dominate disk growth — see sizing below). Ubuntu 24.04 LTS.

## 1. Compose topology (`infra/docker/compose.yml`)

```
services:
  caddy        image: caddy:2-alpine            ports: 80,443 (+443/udp for HTTP/3)   volumes: caddy_data, caddy_config, web_dist (ro)
  api          image: crm/api:<sha>  APP_MODE=api    expose: 4000   depends_on: postgres(healthy), valkey(healthy), seaweedfs(healthy)   deploy.replicas: 1 (scalable)
  worker       image: crm/api:<sha>  APP_MODE=worker                depends_on: same + api   replicas: 1 (CTI leader lock allows more for job processing)
  migrate      image: crm/api:<sha>  command: prisma migrate deploy   profiles: [ops]  (run once per deploy, uses crm_migrate role)
  postgres     image: postgres:17-alpine         volumes: pg_data     healthcheck: pg_isready   shm_size: 256m
  valkey       image: valkey/valkey:8-alpine     command: valkey-server --appendonly yes --requirepass-file …   volumes: valkey_data
  seaweedfs    image: chrislusf/seaweedfs:<pinned>  command: server -s3 -dir=/data -volume.max=0 -master.volumeSizeLimitMB=1024 -s3.config=/etc/seaweedfs/s3.json   volumes: seaweed_data
  backup       image: crm/backup (alpine + postgresql17-client + restic + aws-cli)  cron: 02:30 daily  volumes: pg dumps tmp, seaweed_data (ro), restic cache
  mailpit      (dev only, compose.dev.yml)       SMTP sink with UI
networks:
  crm_internal: internal: true   # postgres, valkey, seaweedfs, worker, backup — no egress
  crm_edge:                      # caddy, api, worker (needs egress to PBX/Meta/SMTP)
volumes: pg_data, valkey_data, seaweed_data, caddy_data, caddy_config, restic_cache   # all labeled com.crm.persistent=true
```

Rules:

- Every service: `restart: unless-stopped`, `healthcheck`, `security_opt: [no-new-privileges:true]`, `cap_drop: [ALL]` (+ minimal `cap_add` for caddy binding 80/443 → `NET_BIND_SERVICE`), `read_only: true` with `tmpfs: /tmp` for api/worker, `logging: json-file max-size 50m max-file 10`, resource `limits` (api 1 GB, worker 1 GB, postgres 2 GB + `shared_buffers=512MB`, valkey 512 MB with `maxmemory 400mb maxmemory-policy noeviction` — BullMQ jobs, sessions and live call state must never be evicted; size the limit so it is never reached, and alert at 80 %).
- **No host ports** except caddy. DB/Valkey/S3 are reachable only on `crm_internal`.
- Images pinned by digest in production; built in CI (`.github/workflows/ci.yml`) and pushed to GHCR; VPS pulls by tag = git SHA.
- `.env.production` on the VPS at `/opt/crm/.env` (`chmod 600 root:root`), referenced with `env_file`. Postgres password also delivered as a Docker secret file.

## 2. Dockerfile (`apps/api/Dockerfile`)

```
FROM node:24-alpine AS base      # pnpm via corepack, workspace install with --frozen-lockfile (deps layer cached)
FROM base AS build               # prisma generate, tsc typecheck, tsup bundle → dist/
FROM node:24-alpine AS runtime   # copy dist + prod node_modules (pnpm deploy --prod), prisma schema+migrations, USER node, HEALTHCHECK curl /health
ENTRYPOINT ["node", "--enable-source-maps"]
CMD ["dist/entry/api.js"]        # compose overrides to dist/entry/worker.js for worker via APP_MODE
```

## 3. Caddyfile (`infra/docker/caddy/Caddyfile`)

```
crm.example.com {
  encode zstd gzip
  header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
    X-Content-Type-Options nosniff
    Referrer-Policy strict-origin-when-cross-origin
    X-Frame-Options DENY
    Content-Security-Policy "default-src 'self'; connect-src 'self' wss://crm.example.com; img-src 'self' data: blob:; media-src 'self' blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'"
    -Server
  }
  @api path /api/* /socket.io/* /webhooks/* /public/* /health
  handle @api {
    reverse_proxy api:4000 { header_up X-Request-Start {time.now.unix_ms}  }
  }
  handle_path /files/* {          # optional: proxy presigned S3 GETs through same origin (keeps CSP tight)
    reverse_proxy seaweedfs:8333
  }
  handle {
    root * /srv/web
    try_files {path} /index.html
    file_server
  }
  log { output file /data/access.log { roll_size 50mb roll_keep 10 } format json }
}
```

Recording/attachment downloads: default is direct presigned URLs to the S3 host; if the S3 host is not public (SeaweedFS internal), the API streams objects through `GET /api/v1/files/:key` (permission-checked, `Range` supported for audio scrubbing). Choose one per deployment via `STORAGE_PUBLIC_URL`.

## 4. VPS bootstrap (`infra/vps/bootstrap.sh`, idempotent)

1. Create `deploy` user with sudo, SSH key only; disable password auth and root login; change SSH port (optional); install `fail2ban`, `unattended-upgrades`.
2. `ufw default deny incoming; allow <ssh-port>/tcp, 80/tcp, 443/tcp, 443/udp, 51820/udp (WireGuard)`; enable.
3. Install Docker Engine + Compose plugin from Docker's repo; add `deploy` to `docker` group; set `/etc/docker/daemon.json` `{ "log-driver": "json-file", "log-opts": {"max-size":"50m","max-file":"10"}, "live-restore": true, "no-new-privileges": true }`.
4. Docker publishes rules that bypass ufw: use `DOCKER-USER` chain rules (or `ufw-docker`) so only caddy's ports are reachable.
5. WireGuard: `wg0` with the VPS as a peer of the site router/PBX network; `AllowedIPs` = PBX subnet only; persistent keepalive 25.
6. Time sync (`chrony`) — CDR timestamps and TOTP depend on it.
7. Create `/opt/crm/{.env,compose.yml,backup}` and `docker compose pull && up -d`.
8. Enable provider-level disk encryption/snapshots if available.

## 5. Deploy procedure (`infra/deploy.sh`, run by CI over SSH or manually)

```
git tag / CI builds image crm/api:<sha> → push GHCR
ssh deploy@vps 'cd /opt/crm && docker compose pull api worker && docker compose run --rm migrate && docker compose up -d api worker && docker compose ps'
```

- Migrations run **before** the new api/worker start; they must be backward compatible with the previous version (expand → migrate → contract pattern) so a rollback is `docker compose up -d` with the previous tag.
- Frontend: CI builds `apps/web` and uploads `dist/` to the `web_dist` volume (or bakes it into a `crm/web` nginx-less image mounted into caddy). Cache-busted assets; `index.html` `no-store`.
- Zero-downtime: api uses `stopGracePeriod 30s`; Fastify `close()` drains connections; Socket.IO clients reconnect to the new container.

## 6. Environment variables (`.env.example` — every key documented)

```
NODE_ENV=production
APP_URL=https://crm.example.com
API_PORT=4000
LOG_LEVEL=info
AUTH_SECRET=                      # openssl rand -base64 48
SECRETS_KEY=                      # 32-byte hex, for AES-256-GCM column encryption
DATABASE_URL=postgresql://crm_app:***@postgres:5432/crm?schema=public
DATABASE_URL_MIGRATE=postgresql://crm_migrate:***@postgres:5432/crm
VALKEY_URL=redis://:***@valkey:6379/0
S3_ENDPOINT=http://seaweedfs:8333   S3_REGION=us-east-1   S3_BUCKET=crm   S3_ACCESS_KEY=   S3_SECRET_KEY=   S3_FORCE_PATH_STYLE=true
STORAGE_PUBLIC_URL=               # empty → stream through API
SMTP_URL=smtps://user:pass@smtp.example.com:465   MAIL_FROM="CRM <no-reply@example.com>"
YEASTAR_BASE_URL=https://10.8.0.2:8088            # over WireGuard, or https://tenant.yeastarcloud.com
YEASTAR_CLIENT_ID=   YEASTAR_CLIENT_SECRET=   YEASTAR_TLS_FINGERPRINT_SHA256=   YEASTAR_TLS_CA_FILE=   # CA bundle path and/or SPKI pin; never rejectUnauthorized=false
YEASTAR_TIMEZONE=Africa/Nairobi                   # PBX local time used to parse CDR timestamps
YEASTAR_EVENT_SOURCE=both   YEASTAR_WEBHOOK_SECRET=
LINKUS_SDK_ENABLED=false   LINKUS_ACCESS_ID=   LINKUS_ACCESS_KEY=
WHATSAPP_ENABLED=false   WHATSAPP_ACCESS_TOKEN=   WHATSAPP_APP_SECRET=   WHATSAPP_VERIFY_TOKEN=   WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_GRAPH_VERSION=v23.0   WHATSAPP_API_BASE_URL=https://graph.facebook.com   # base URL is overridden only in tests
TRUST_PROXY_HOPS=1                # Caddy in front of the API
OPENAPI_ENABLED=false
WEB_IMAGE=ghcr.io/OWNER/crm-web:latest   # static SPA publisher image; copies dist into the web_dist volume served by Caddy
METRICS_ENABLED=true
FIRST_ADMIN_EMAIL=   FIRST_ADMIN_NAME=          # seed creates the first admin and emails a set-password link
```

## 7. Observability

- Logs: Pino JSON → Docker json-file with rotation. `docker compose logs -f api worker`. Optional Loki/Promtail later.
- Metrics: `/metrics` (Prometheus) on api and worker (internal network only): HTTP latency/status, `cti_pop_latency_ms`, `cti_connected`, `cti_events_total{type}`, `bullmq_jobs{queue,state}`, `db_pool_*`, `socket_connections`.
- Uptime Kuma (separate small container or external): HTTPS check on `/health`, keyword check on `/ready` (`"pbx":{"connected":true`), alert to email/Telegram.
- Alerts (minimum): api down 1 min, PBX disconnected 2 min, backup job failed / no backup in 26 h, disk > 80 %, pop latency p95 > 1 s, queue failed jobs > 0 for 10 min.

## 8. Sizing & growth

- Recordings: WAV 8 kHz mono ≈ 1 MB/min → 100 agents × 3 h talk/day ≈ 18 GB/day worst case; typical SMB ≈ 1–3 GB/day. Set `Setting.recording.retentionDays` and monitor `seaweed_data`. Optionally transcode to Opus (≈ 10× smaller) in the download job (`RECORDING_TRANSCODE=opus`, ffmpeg in worker image) — keeps originals only if legally required.
- PostgreSQL: CRM tables are small (< 5 GB for years of data); `activities` and `pbx_events` grow fastest; retention job trims `pbx_events`.
- Vertical scaling first (VPS resize); horizontal: api replicas behind caddy + more workers; DB stays single node with backups (managed Postgres is an option later — the app only needs a connection string).

## 9. Runbook (short)

| Situation              | Action                                                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PBX disconnected       | `docker compose logs worker                                                                                                                                               | grep cti` → token errors? check plan/credentials/IP allowlist/WireGuard (`wg show`); reconnection is automatic; run reconcile from admin UI after |
| Screen pops slow       | check `cti_pop_latency_ms`, worker CPU, Valkey latency, DB slow log                                                                                                       |
| Disk almost full       | prune old recordings per retention, `docker system prune` (images only), resize volume                                                                                    |
| Restore needed         | follow [13](13-backup-recovery.md) restore drill                                                                                                                          |
| Secret leak            | rotate as per [08 M5](08-security-rules.md), revoke all sessions (`POST /api/auth/admin/revoke-all` or SQL truncate sessions), rotate Yeastar client secret in PBX portal |
| Upgrade Postgres major | `pg_dumpall` → new container → restore (documented, tested on staging first)                                                                                              |
