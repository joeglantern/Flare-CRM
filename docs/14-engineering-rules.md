# 14 — Engineering Rules

## 1. TypeScript

- `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `noImplicitOverride: true`, `verbatimModuleSyntax: true`, `module: NodeNext`, `target: ES2023`.
- ESM only (`"type": "module"`); imports use explicit `.js` extensions in relative paths (NodeNext).
- No `any`. Use `unknown` at boundaries and narrow with Zod. No non-null assertions (`!`) outside tests; use guards.
- Types are inferred from Zod schemas (`z.infer`) — never hand-write a DTO that duplicates a schema.
- Prefer `readonly` and immutable updates; no mutation of function arguments.
- Errors: throw `AppError` subclasses (`NotFoundError`, `ForbiddenError`, `ConflictError`, `ValidationError`, `PbxUnavailableError`); never throw strings; never swallow errors (`catch` must handle, wrap with context, or rethrow).
- Async: no floating promises (lint), always `await` inside `try`; use `Promise.allSettled` for fan-out where partial failure is acceptable.

## 2. Module boundaries

- Modules import from other modules **only** through their `index.ts` service exports; never from another module's repository.
- `integrations/*` are the only files allowed to import vendor SDKs / call external HTTP.
- `packages/shared` has zero runtime deps except `zod` and `libphonenumber-js`.
- Circular imports are a build error (`madge --circular` in CI).
- Cross-module reactions (e.g. a call finished → notification) go through the **event bus**, not direct service calls, to keep modules decoupled: `eventBus.emit('call.logged', payload)`; listeners are registered in `modules/*/index.ts`.

## 3. Database & Prisma

- Access through repositories; every scoped read applies `visibility.scope`.
- Transactions: `prisma.$transaction(async tx => …)` with all writes of one use case (entity + activity + audit). Pass `tx` down; never open nested transactions.
- Migrations: `prisma migrate dev --create-only` → review/edit SQL → `prisma migrate dev`; production uses `prisma migrate deploy`. Every migration is backward compatible with the currently running app version (expand/contract). Data migrations are separate scripts in `prisma/data-migrations/`, idempotent.
- Indexes are declared in the schema (or SQL migration) and justified by a query; every list endpoint has a covering index for its default sort.
- Never `SELECT *` implicitly for large rows: use `select` for list endpoints.
- N+1: use `include` deliberately, or aggregate in SQL; tests use a Prisma query counter to assert ≤ N queries for list routes.

## 4. Fastify specifics

- Plugins wrapped with `fastify-plugin` only for infrastructure decorators; module routes are encapsulated plugins registered with a `prefix`.
- Use `fastify.withTypeProvider<ZodTypeProvider>()` and declare `schema: { params, querystring, body, response, tags, security }` on **every** route.
- Use `request.log` (child logger with request id) — never the global logger in request context.
- Hooks order: `onRequest` (request id, context) → `preParsing` (raw body for webhooks) → `preValidation` (auth) → `preHandler` (permissions, scope) → handler.
- Graceful shutdown: `SIGTERM` → stop accepting → close sockets with `server:shutdown` → drain queues → disconnect Prisma/Valkey → exit within 25 s.

## 5. Logging

- Pino JSON; levels: `error` (needs action), `warn` (degraded but handled), `info` (business events: call logged, user created), `debug` (dev only).
- Every log line in request context has `requestId`, `userId?`, `route`. Worker logs carry `pbxCallId` when applicable.
- Redaction list in `config/logging.ts` (see [08 F3](08-security-rules.md)).
- No PII in `error.message` strings that may reach clients.

## 6. Testing

| Layer             | Tool                                                               | What                                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit              | Vitest                                                             | pure functions: phone normalization, direction detection, visibility scope, CSV sanitization, HMAC verification, state machine transitions (fixture-driven) |
| Integration       | Vitest + Testcontainers (PostgreSQL 17, Valkey 8) + `app.inject()` | every route: happy path, validation failure, 401, 403 (each role), 404 out-of-scope, idempotency, audit row written, activity row written                   |
| CTI               | Fixture replay through `dispatch()` against real DB                | inbound answered/missed, outbound, queue multi-ring, CDR-only gap, duplicate CDR, reconnect + reconcile                                                     |
| Contract          | Zod schemas ↔ OpenAPI snapshot                                     | breaking-change detection on `/api/v1`                                                                                                                      |
| Security          | dedicated suite                                                    | IDOR per entity, mass-assignment, CSV injection, webhook bad signature, rate limit triggers, headers present                                                |
| Load (pre-launch) | k6                                                                 | 100 concurrent agents, 50 simultaneous ringing events → p95 pop latency < 1 s                                                                               |

- Coverage gate: 85 % lines on `modules/**` and `integrations/**`; CTI state machine 100 % branch.
- Tests never hit real PBX/Meta/SMTP; adapters have in-memory fakes.
- Seed factories (`test/factories`) build valid entities quickly.

## 7. Git & CI

- Trunk-based: `main` protected; feature branches `feat/<id>-<slug>`; squash merge.
- Conventional commits with requirement IDs: `feat(calls): R-4.2.1 log call from CDR event`.
- PR checklist: docs updated (if behavior changed), schema+migration, tests, audit/activity written, permission guard present, no new env var without `.env.example` + Zod.
- CI (`ci.yml`): install (frozen) → lint → typecheck → unit → integration (testcontainers) → build images → Trivy → openapi snapshot → (on tag) push images.
- `lefthook` pre-commit: prettier + eslint on staged, `tsc --noEmit` on push.

## 8. Code review rules of thumb

- Reject any route without both `requireAuth` and `requirePermission`.
- Reject any Prisma read of scoped entities that bypasses the repository scope.
- Reject any new external call outside `integrations/`.
- Reject any `console.*`, `any`, `@ts-ignore`, disabled lint rule without justification.
- Reject any secret-like literal (`gitleaks` runs in CI).
- Prefer deleting code to adding config; prefer boring, well-known patterns over clever ones.

## 9. Definition of done (per feature)

1. Traceability ID referenced; behavior matches the doc.
2. Zod schemas in `packages/shared`, route with guards, service, repository, tests (unit + integration) green.
3. Activity and audit rows where applicable; socket events documented in [10](10-realtime-contract.md) if added.
4. OpenAPI snapshot updated; `.env.example` updated; migration reviewed.
5. Logs/metrics for new failure modes.
6. Docs updated in the same PR.
