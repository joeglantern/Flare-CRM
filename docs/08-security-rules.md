# 08 — Security Rules (non-negotiable)

These rules are enforced by code review, lint rules, tests and CI. A PR that violates one is
blocked. Threat model: internet-facing single-tenant CRM holding customer PII, call recordings,
and chat transcripts; attackers include anonymous internet users, compromised agent accounts,
and malicious webhook senders.

## A. Transport & edge

- A1. TLS only. Caddy terminates TLS 1.2+ with automatic Let's Encrypt; HTTP → HTTPS redirect; HSTS `max-age=31536000; includeSubDomains; preload`.
- A2. Only ports 22 (key-only SSH, ideally non-standard port + fail2ban), 80, 443 (and the WireGuard UDP port) are open on the VPS firewall. No container publishes any other host port in production.
- A3. Caddy sets `X-Forwarded-For`/`X-Forwarded-Proto`; Fastify runs with `trustProxy: 1` (exactly one hop). Client IP for rate limits/audit is taken only from that trusted hop.
- A4. Request body limit 1 MiB for JSON; uploads via multipart limited to 25 MiB per file (configurable), streamed to object storage.
- A5. Timeouts: `connectionTimeout 10 s`, `requestTimeout 30 s`, keep-alive 72 s (> Caddy's), `@fastify/under-pressure` sheds load at 90 % heap/event-loop delay 1 s with `503`.

## B. HTTP headers (`@fastify/helmet`)

- B1. `Content-Security-Policy` for the SPA (set by Caddy on static responses): `default-src 'self'; connect-src 'self' wss://crm.<domain> https://<pbx-host-if-webrtc>; img-src 'self' data: blob: https://<s3-host>; media-src 'self' blob: https://<s3-host>; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'`.
- B2. API responses: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: microphone=(self), camera=(), geolocation=()`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, no `X-Powered-By`.
- B3. CORS: `origin` = exact `APP_URL` (plus explicit dev origins), `credentials: true`, methods/headers allowlisted, `maxAge 86400`. Wildcards are forbidden.

## C. Authentication & sessions

- C1. Only Better Auth issues sessions; no custom JWTs for browsers. Cookies `HttpOnly; Secure; SameSite=Lax`.
- C2. CSRF: Better Auth origin/`Sec-Fetch` checks stay enabled (`disableCSRFCheck` and `disableOriginCheck` are forbidden). Our own state-changing routes require `Content-Type: application/json` (no form posts) and same-origin `Origin`/`Sec-Fetch-Site` (checked in `plugins/security.ts`).
- C3. 2FA required for admin/manager. Sign-up disabled; admin-created users only.
- C4. Session revocation on: password change/reset, role change, deactivation, ban, admin "sign out everywhere".
- C5. `AUTH_SECRET` ≥ 32 random bytes; rotated via Better Auth versioned secrets; never logged.

## D. Authorization

- D1. Every non-public route declares `requireAuth` and a `requirePermission(resource, action)`; a route without a guard fails a startup assertion (`plugins/authorize.ts` walks the route table on `ready`).
- D2. Record-level scoping applied in repositories (see [07 §4](07-auth-rbac.md#4-record-level-visibility-r-752)); IDs in URLs are UUIDv7 (unguessable) but **never** the only control — IDOR tests exist for every entity.
- D3. Mass assignment is impossible: Zod body schemas are `.strict()`; server-controlled fields (`ownerId` unless `assign` permission, `createdById`, timestamps, `pbx*`) are never accepted from clients.
- D4. Public endpoints (web form submit, webhooks, health) live under `/public/*`, `/webhooks/*`, `/health` and are the **only** routes allowed to skip `requireAuth` (allowlist enforced by the startup assertion).

## E. Input validation & output encoding

- E1. All params/query/body/headers validated with Zod via the type provider; unknown keys rejected; strings length-capped; enums exact; numbers bounded; dates ISO-8601; UUIDs `z.uuid()`; phones via libphonenumber; emails `z.email()` + max 254.
- E2. Response schemas are declared for every route so serialization never leaks unlisted fields (e.g. password hashes, secrets, internal keys).
- E3. Free text (notes, messages, custom fields) is stored raw and rendered as text by the SPA (React escapes); Markdown, if ever enabled, is sanitized with a strict allowlist. No HTML is accepted from clients.
- E4. SQL only via Prisma or `$queryRaw` tagged templates (parameterized). String concatenation into SQL is a lint error. `$queryRawUnsafe`/`$executeRawUnsafe` are forbidden.
- E5. CSV export cells starting with `= + - @ \t \r` are prefixed with `'` (CSV injection).
- E6. File uploads: extension + MIME sniffed with `file-type` on the first bytes; allowlist (`image/*` for avatars; documents/audio/images for attachments); random object keys (never user-supplied names); `Content-Disposition: attachment` and `nosniff` when serving.

## F. Secrets & configuration

- F1. Secrets only from environment (`.env` with `chmod 600`, not in git; `.env.example` documents keys without values). Startup Zod validation refuses missing/weak values (e.g. `AUTH_SECRET.length < 32`).
- F2. Third-party secrets stored in DB (channel tokens) are encrypted with AES-256-GCM using `SECRETS_KEY` (32 bytes), IV per record, key id for rotation.
- F3. Logs redact: `authorization`, `cookie`, `set-cookie`, `password`, `*token*`, `*secret*`, `access_token` query strings, message bodies, phone numbers beyond last 4 digits in info-level logs (full numbers only at debug in dev).
- F4. No secrets in the frontend bundle. Yeastar client secret, webhook secrets, Meta app secret, S3 keys exist only in the api/worker containers.

## G. Rate limiting & abuse

- G1. Global: 300 req/min per IP (authenticated: per user id). Auth routes stricter (see [07](07-auth-rbac.md)). Dial: 10/min/user. Web form: 5/min/IP + honeypot field + optional Turnstile.
- G2. Socket.IO: max 3 connections per user; event rate 20/s per socket; unknown events ignored and counted.
- G3. All limits use Valkey so they hold across api replicas.

## H. Webhooks (inbound)

- H1. Raw body captured before parsing; signature verified with `crypto.timingSafeEqual` on equal-length buffers:
  - Yeastar: `X-Signature` = `base64(HMAC-SHA256(rawBody, webhookSecret))`.
  - WhatsApp (Meta): `X-Hub-Signature-256` = `sha256=` + `hex(HMAC-SHA256(rawBody, appSecret))`; GET verification handshake checks `hub.verify_token` against env.
- H2. Reject on missing/invalid signature with `401` and no body detail; log source IP.
- H3. Verify → enqueue with deterministic `jobId` → `200` immediately. No DB writes in the request handler.
- H4. Optional source IP allowlist for Yeastar webhook when on WireGuard.

## I. Outbound requests (SSRF)

- I1. The backend only calls hosts from configuration (`YEASTAR_BASE_URL`, Meta Graph API, S3 endpoint, SMTP). User-supplied URLs are never fetched server-side (no link previews, no "import from URL").
- I2. Yeastar download URLs are validated to be path-only (`download_resource_url` starts with `/`) and joined to the configured base — never followed if absolute to another host.
- I3. All outbound calls have `AbortSignal.timeout` (10 s API, 120 s recording stream) and retries with jitter only for idempotent operations.

## J. Data protection

- J1. Disk encryption on the VPS (provider-level or LUKS) — **CONFIRM** with hosting provider; backups encrypted client-side by restic (AES-256) with the key stored outside the VPS (password manager).
- J2. Recordings and attachments are private objects; access only via presigned URLs (TTL ≤ 5 min) issued after a permission check; every recording access is audited.
- J3. PII minimization: raw webhook payloads (`messages.raw`, `pbx_events`) purged by the retention job; recording retention `Setting.recording.retentionDays`; soft-deleted records purged after `softDeletePurgeDays`.
- J4. Right-to-erasure procedure (Kenya DPA / GDPR-style): admin action `POST /api/v1/contacts/:id/erase` anonymizes PII in contact, phones, emails, messages bodies, recordings deleted from storage, audit entry kept with hashed identifiers. Requires `admin` + reason.
- J5. Recording consent: PBX plays the consent prompt (client responsibility, documented in [16](16-open-questions-and-assumptions.md)); CRM stores `Setting.recording.consentText` for the policy page and exposes a per-contact `recordingOptOut` flag (P2) that hides playback and triggers `record_pause` on answer where supported.

## K. Audit

- K1. Append-only `audit_logs` with DB trigger blocking UPDATE/DELETE; app DB role lacks `DELETE` on it.
- K2. Logged actions: auth events, user/role changes, settings changes, any create/update/delete on business entities (with before/after diff), recording access/download, exports (with row count), CTI control commands, webhook signature failures, permission denials (`403`).
- K3. `request_id` (UUIDv7) is generated per request, returned in `X-Request-Id`, included in logs and audit rows.

## L. Dependencies & supply chain

- L1. Exact versions pinned; `pnpm install --frozen-lockfile` in CI/Docker; `pnpm audit --prod` and `osv-scanner` in CI (fail on high/critical); Renovate/Dependabot weekly.
- L2. `minimumReleaseAge` (pnpm) = 3 days for new versions to avoid freshly-published malicious releases.
- L3. Docker images: official base images by digest, multi-stage, non-root `USER node`, `--read-only` root FS + tmpfs `/tmp`, `no-new-privileges`, dropped capabilities; Trivy scan in CI.

## M. Operations

- M1. Separate DB roles: `crm_app` (DML only, no DDL, no DELETE on audit_logs), `crm_migrate` (DDL, used only by the migration job), `crm_backup` (read-only). Superuser never used by the app.
- M2. Database and Valkey require passwords even on the internal network; Valkey has `protected-mode yes`, no host port, ACL user for the app.
- M3. `docker compose down -v` is forbidden on production (documented; volumes are also labeled `com.crm.persistent=true` and a wrapper script refuses `-v`).
- M4. Health endpoints expose no secrets or versions of internal components to unauthenticated callers (`/health` → `{status}` only; `/ready` detail requires internal network or admin).
- M5. Incident response: rotate `AUTH_SECRET`, `SECRETS_KEY` (re-encrypt), Yeastar client secret, Meta tokens, S3 keys; revoke all sessions; review audit logs. Runbook in [12](12-infrastructure-docker.md).

## N. Forbidden list (lint/CI enforced)

`eval`, `new Function`, `child_process` in api/worker code, `$queryRawUnsafe`, `NODE_TLS_REJECT_UNAUTHORIZED=0`, `rejectUnauthorized: false`, `any` (use `unknown` + narrowing), `// @ts-ignore` without a linked issue, `console.log` (use the logger), `Math.random()` for anything security-related (use `crypto.randomBytes`/`randomUUID`), `disableCSRFCheck`, wildcard CORS, storing plaintext third-party secrets, catching errors without handling or rethrowing.
