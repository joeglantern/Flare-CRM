# 04 — Repository Structure

```
CRM/
├── docs/                          # this documentation (source of truth)
├── apps/
│   ├── api/                       # Fastify backend (api + worker entrypoints)
│   ├── web/                       # Vite/React frontend (built after backend)
│   ├── console-api/               # owner console backend: customers, plans, entitlements (docs/21)
│   └── console-web/               # owner console client
├── packages/
│   ├── shared/                    # Zod schemas, DTO types, enums, constants, visibility helpers
│   ├── ui/                        # design system primitives shared by both clients
│   └── tsconfig/                  # shared tsconfig bases
├── infra/
│   ├── docker/
│   │   ├── compose.yml            # production topology
│   │   ├── compose.dev.yml        # dev overrides (ports, hot reload, mailpit)
│   │   ├── caddy/Caddyfile
│   │   ├── postgres/init/*.sql    # extensions (citext, pg_trgm), roles
│   │   ├── seaweedfs/             # s3 config json (identities/policies)
│   │   └── backup/                # restic + pg_dump scripts, crontab
│   ├── console/                   # the owner console's own compose stack (docs/21)
│   ├── provision-customer.sh      # stands a customer stack up on a bootstrapped VPS
│   └── vps/                       # bootstrap script (ufw, docker, wireguard), hardening notes
├── .github/workflows/ci.yml       # lint, typecheck, test, build images
├── .env.example                   # every variable documented; never real values
├── package.json                   # workspace root scripts only
├── pnpm-workspace.yaml
├── lefthook.yml                   # pre-commit: lint-staged, typecheck, test:unit
├── eslint.config.js
├── .prettierrc
└── README.md                      # quick start pointing to docs/
```

> Status 2026-09-05: `apps/web` exists as plumbing only (tokens, API client, auth, socket, call store, routing guards, placeholder sign-in/home). See `apps/web/README.md` for the actual layout.

## `apps/api`

```
apps/api/
├── prisma/
│   ├── schema.prisma
│   ├── migrations/                # committed; includes hand-written SQL (tsvector, partial unique, audit trigger)
│   └── seed.ts                    # dispositions, default pipeline, settings, first admin (from env)
├── prisma.config.ts               # Prisma 7 config (datasource url from env, migrations path)
├── src/
│   ├── entry/
│   │   ├── api.ts                 # builds app, listens :4000, attaches Socket.IO
│   │   └── worker.ts              # CTI subscriber + BullMQ workers + schedulers
│   ├── app.ts                     # buildApp(): registers plugins + modules (used by tests)
│   ├── config/
│   │   ├── env.ts                 # Zod-validated process.env → typed Config
│   │   └── constants.ts
│   ├── plugins/                   # Fastify plugins (infrastructure only, fastify-plugin wrapped)
│   │   ├── prisma.ts              # PrismaClient with @prisma/adapter-pg, graceful disconnect
│   │   ├── valkey.ts              # ioredis clients (main, sub, bullmq)
│   │   ├── auth.ts                # Better Auth instance + /api/auth/* handler + request.session decorator
│   │   ├── authorize.ts           # requirePermission()/requireRole() route helpers
│   │   ├── security.ts            # helmet, cors, rate-limit, under-pressure, cookie
│   │   ├── socket.ts              # Socket.IO server on fastify.server, auth handshake, rooms, valkey adapter
│   │   ├── storage.ts             # S3 client + presign helpers
│   │   ├── mailer.ts              # Nodemailer transport
│   │   ├── queues.ts              # BullMQ Queue instances (producers)
│   │   ├── event-bus.ts           # typed in-process domain event emitter
│   │   ├── request-context.ts     # requestId, actor, ip → AsyncLocalStorage
│   │   ├── openapi.ts             # swagger (guarded)
│   │   └── health.ts              # /health (liveness), /ready (db, valkey, storage, pbx)
│   ├── modules/                   # one folder per bounded context — see below
│   │   ├── users/
│   │   ├── teams/
│   │   ├── contacts/
│   │   ├── companies/
│   │   ├── custom-fields/
│   │   ├── leads/
│   │   ├── pipelines/
│   │   ├── deals/
│   │   ├── tasks/
│   │   ├── notes/
│   │   ├── calls/                 # Call records, dispositions, dial, control, recordings
│   │   ├── messaging/             # channels, conversations, messages, adapters/
│   │   ├── activity/              # timeline writer + query
│   │   ├── audit/
│   │   ├── notifications/
│   │   ├── reports/
│   │   ├── import-export/
│   │   ├── web-forms/
│   │   ├── settings/
│   │   └── webhooks/              # /webhooks/yeastar, /webhooks/whatsapp (verify + enqueue only)
│   ├── integrations/
│   │   ├── yeastar/
│   │   │   ├── client.ts          # typed Open API client (get_token/refresh/del, dial, control, cdr, recording)
│   │   │   ├── token-manager.ts   # single-token lifecycle in Valkey with lock
│   │   │   ├── events.ts          # Zod schemas for 30007/30008/30011/30012/30013/30016/30031/30032/30033
│   │   │   ├── subscriber.ts      # WebSocket connect/heartbeat/resubscribe/backoff + leader lock
│   │   │   ├── call-state.ts      # CTI state machine over Valkey hashes
│   │   │   ├── normalize.ts       # number normalization, direction detection, extension mapping
│   │   │   ├── reconcile.ts       # cdr/list gap fill
│   │   │   └── webhook-verify.ts  # X-Signature HMAC-SHA256 base64
│   │   ├── messaging/             # channel-adapter.ts (contract) + whatsapp-adapter.ts (Meta Cloud API)
│   │   │                          # yeastar-messaging adapter: Phase 3 (same ChannelAdapter contract)
│   │   └── storage/               # S3 wrapper (put stream, presign, delete, head)
│   ├── jobs/                      # BullMQ processors (worker only)
│   │   ├── recording-download.ts
│   │   ├── cdr-reconcile.ts
│   │   ├── email-send.ts
│   │   ├── task-reminder.ts
│   │   ├── csv-import.ts
│   │   ├── processors.ts          # all BullMQ processors (email, reminders, recording, cti, messaging, csv, retention)
│   │   ├── csv-import.ts
│   │   └── retention.ts           # nightly purge: soft-deletes, pbx_events, raw payloads, expired recordings
│   ├── lib/                       # pure helpers (phone, crypto, pagination, errors, result)
│   └── types/                     # global d.ts (fastify decorators, session augmentation)
├── test/
│   ├── setup/                     # testcontainers bootstrap, app factory, auth helpers
│   ├── unit/
│   ├── integration/
│   └── fixtures/yeastar-events/*.json
├── Dockerfile                     # multi-stage; CMD selects entry via APP_MODE=api|worker
├── package.json
└── tsconfig.json
```

### Module anatomy (every module identical)

```
modules/contacts/
├── contacts.routes.ts     # fastify plugin: declares routes, schemas, guards; calls service
├── contacts.schemas.ts    # Zod: params/query/body/response (re-exported from packages/shared where shared)
├── contacts.service.ts    # business rules, transactions, domain events
├── contacts.repository.ts # Prisma access with visibility scope
├── contacts.events.ts     # domain event types emitted by this module
├── contacts.test.ts       # integration tests via app.inject()
└── index.ts               # registers the plugin under prefix
```

## Naming

| Thing          | Convention                              | Example                             |
| -------------- | --------------------------------------- | ----------------------------------- |
| Files          | kebab-case, suffix by role              | `call-state.ts`, `deals.service.ts` |
| Classes/types  | PascalCase                              | `CallStateMachine`, `ContactDto`    |
| Functions/vars | camelCase                               | `normalizeE164()`                   |
| DB tables      | snake_case plural via `@@map`           | `contact_phones`                    |
| DB columns     | snake_case via `@map`                   | `owner_id`                          |
| Env vars       | SCREAMING_SNAKE with prefix per concern | `YEASTAR_BASE_URL`, `S3_BUCKET`     |
| Socket events  | `domain:action`                         | `call:ringing`, `message:new`       |
| Queues         | `domain.action`                         | `recording.download`                |
| Permissions    | `resource:action`                       | `contact:export`                    |
| REST paths     | plural nouns, kebab-case, `/api/v1`     | `/api/v1/custom-fields`             |

## `packages/shared`

```
packages/shared/src/
├── schemas/        # Zod schemas for every DTO (contact, deal, call, message, …)
├── enums.ts        # CallDirection, CallStatus, DealStatus, ChannelType, ActivityType, Role …
├── permissions.ts  # access-control statement + role definitions (imported by api + web)
├── socket-events.ts# typed map of socket event name → payload schema
├── visibility.ts   # pure function: (actor, setting) → scope descriptor
└── phone.ts        # E.164 helpers shared by web (display) and api (storage)
```

Nothing in `packages/shared` may import Node-only or browser-only APIs.
