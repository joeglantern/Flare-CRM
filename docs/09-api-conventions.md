# 09 — API Conventions

Base path `/api/v1`. JSON only (`application/json; charset=utf-8`). Auth routes live at
`/api/auth/*` (Better Auth). Webhooks at `/webhooks/*`. Public (unauthenticated) at
`/public/*`. Health at `/health`, `/ready`.

## 1. Resource routes

| Pattern                      | Meaning                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| `GET /contacts`              | list (paginated, filterable, sortable, scoped)                                       |
| `POST /contacts`             | create → `201` + resource                                                            |
| `GET /contacts/:id`          | read → `200`                                                                         |
| `PATCH /contacts/:id`        | partial update → `200` + resource (no `PUT`)                                         |
| `DELETE /contacts/:id`       | soft delete → `204`                                                                  |
| `POST /contacts/:id/restore` | undo soft delete (manager+)                                                          |
| `POST /deals/:id/stage`      | action on resource (verb as sub-resource) → `200`                                    |
| `GET /contacts/:id/timeline` | sub-collection                                                                       |
| `POST /contacts/bulk`        | bulk actions `{ action: 'assign'\|'tag'\|'delete', ids: [], payload }` — max 500 ids |

Paths are plural kebab-case. IDs are UUIDv7 strings.

## 2. Requests

- Body/query validated by Zod (`.strict()`); reject unknown keys → `422`.
- Pagination: **cursor** for timelines/messages (`?cursor=&limit=` where cursor is an opaque base64url of `(occurredAt,id)`), **offset** for admin tables (`?page=1&pageSize=25`, `pageSize ≤ 100`).
- Filtering: explicit query params per resource (`?ownerId=&stageId=&status=&q=`), never a generic JSON filter language.
- Sorting: `?sort=-createdAt,displayName` (leading `-` = desc), allowlisted per resource.
- Full-text: `?q=` uses tsvector/trigram; min 2 chars.
- Dates in/out: ISO-8601 UTC (`2026-09-05T10:20:30.000Z`); date-only fields as `YYYY-MM-DD`.
- Phone numbers in: any format + optional `country`; out: E.164 plus `display` (national format).
- Idempotency: `POST` that create side effects (dial, send message, import) accept `Idempotency-Key` header (UUID); server stores `(userId, key) → response` in Valkey for 24 h and replays it.
- `X-Request-Id` optional inbound (must be UUID) else generated; always echoed.

## 3. Responses

Success:

```json
{ "data": { ... } }                                        // single
{ "data": [ ... ], "page": { "cursor": "…", "hasMore": true } }        // cursor list
{ "data": [ ... ], "page": { "page": 1, "pageSize": 25, "total": 1234 } } // offset list
```

Error (RFC 9457-style, always this shape):

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Request validation failed",
    "details": [{ "path": "phones.0.number", "message": "Invalid phone number" }],
    "requestId": "019…"
  }
}
```

| HTTP | code                                                              | when                                                                 |
| ---- | ----------------------------------------------------------------- | -------------------------------------------------------------------- |
| 400  | `BAD_REQUEST`                                                     | malformed JSON, bad cursor                                           |
| 401  | `UNAUTHENTICATED`                                                 | no/invalid session                                                   |
| 403  | `FORBIDDEN` (+`required`) / `TWO_FACTOR_REQUIRED` / `DO_NOT_CALL` | permission or policy                                                 |
| 404  | `NOT_FOUND`                                                       | also used for out-of-scope records (do not reveal existence)         |
| 409  | `CONFLICT` / `DUPLICATE` (+`matches[]`) / `STALE_VERSION`         | uniqueness, optimistic concurrency                                   |
| 413  | `PAYLOAD_TOO_LARGE`                                               |                                                                      |
| 422  | `VALIDATION_FAILED`                                               | Zod failures                                                         |
| 429  | `RATE_LIMITED` (+`Retry-After`)                                   |                                                                      |
| 503  | `PBX_UNAVAILABLE` / `SERVICE_UNAVAILABLE`                         | dependency down / under pressure                                     |
| 500  | `INTERNAL`                                                        | never includes stack traces or messages from internals in production |

Application errors are thrown as `AppError(code, status, message, details?)` from services; a single Fastify `setErrorHandler` maps Zod, Prisma (`P2002` → `409`, `P2025` → `404`), and `AppError` to this shape and logs 5xx with the request id.

## 4. Optimistic concurrency

Mutable business resources expose `updatedAt`; `PATCH` may include `If-Unmodified-Since`-style body field `expectedUpdatedAt`; mismatch → `409 STALE_VERSION`. Frontend sends it for forms that were open a while (deals, contacts).

## 5. Versioning

`/api/v1` is frozen once the frontend ships. Additive changes (new optional fields) are fine; breaking changes require `/api/v2` and a deprecation window. Socket events are versioned by name (`call:ringing` → `call:ringing.v2` if the payload breaks).

## 6. OpenAPI

Generated from the Zod route schemas at startup; served at `/api/docs` only when `OPENAPI_ENABLED=true` (dev) or to `admin` role in prod behind auth. The JSON is also exported in CI (`pnpm openapi:export`) and used to generate the frontend client types (`openapi-typescript`) — the frontend never hand-writes API types.

## 7. Endpoint inventory (P1 backend)

```
Auth (Better Auth)         /api/auth/*  (sign-in/email, sign-out, get-session, two-factor/*, forget-password, reset-password, admin/*)
Users                      GET/POST /users, GET/PATCH /users/:id, POST /users/:id/role|deactivate|reactivate|sessions/revoke, GET /users/me, PATCH /users/me, POST/DELETE /users/me/avatar
Teams                      GET/POST /teams, PATCH/DELETE /teams/:id, POST /teams/:id/members
Contacts                   GET/POST /contacts, GET/PATCH/DELETE /contacts/:id, POST /contacts/:id/restore, GET /contacts/:id/timeline,
                           GET /contacts/duplicates, POST /contacts/:id/merge, POST /contacts/bulk, POST /contacts/:id/avatar,
                           POST /contacts/:id/phones, PATCH/DELETE /contacts/:id/phones/:phoneId (same for emails), POST /contacts/:id/erase
Companies                  GET/POST /companies, GET/PATCH/DELETE /companies/:id, GET /companies/:id/contacts, GET /companies/:id/timeline
Custom fields              GET/POST /custom-fields, PATCH/DELETE /custom-fields/:id, POST /custom-fields/reorder
Leads                      GET/POST /leads, GET/PATCH/DELETE /leads/:id, POST /leads/:id/convert, POST /leads/bulk
Pipelines                  GET/POST /pipelines, PATCH/DELETE /pipelines/:id, POST /pipelines/:id/stages, PATCH/DELETE /pipelines/:id/stages/:stageId, POST /pipelines/:id/stages/reorder
Deals                      GET/POST /deals, GET/PATCH/DELETE /deals/:id, POST /deals/:id/stage, GET /deals/:id/history, GET /deals/board?pipelineId=, POST /deals/bulk
Tasks                      GET/POST /tasks, GET/PATCH/DELETE /tasks/:id, POST /tasks/:id/complete, GET /tasks/calendar?from=&to=
Notes                      GET/POST /notes, PATCH/DELETE /notes/:id (parent given in body: contactId|dealId|companyId|callId)
Calls                      GET /calls, GET /calls/:id, POST /calls/dial, PATCH /calls/:id/disposition, POST /calls/:id/link-contact,
                           GET /calls/:id/recording (presigned), DELETE /calls/:id/recording, POST /calls/:id/control { action: hangup|hold|unhold|mute|unmute|transfer|answer|decline, ... }
Dispositions               GET/POST /call-dispositions, PATCH/DELETE /call-dispositions/:id
CTI                        GET /cti/capabilities, GET /cti/status (admin), POST /cti/reconcile (admin), POST /cti/linkus-sign, GET /cti/live-calls (manager+)
Messaging (P2)             GET/POST /channels, PATCH /channels/:id (secrets encrypted, never returned), GET/POST /conversations, GET /conversations/:id,
                           GET /conversations/:id/messages, POST /conversations/:id/messages (202 → queued; template required outside the 24 h window),
                           POST /conversations/:id/read|assign|close|reopen|archive, POST /attachments (multipart, upload before send)
Activity                   GET /activity?contactId=|dealId=&types=&q=&cursor=   (timeline)
Notifications              GET /notifications, POST /notifications/read-all, POST /notifications/:id/read, GET/PUT /notifications/preferences
Reports                    GET /reports/calls/summary, /reports/calls/agents, /reports/calls/missed, /reports/pipeline/summary, /reports/pipeline/conversion, /reports/pipeline/forecast  (+ ?format=csv)
Import/Export              POST /imports (multipart csv + mapping), GET /imports/:id, GET /exports/:entity?format=csv (streamed)
Web forms                  GET/POST /web-forms, PATCH/DELETE /web-forms/:id;  PUBLIC: POST /public/forms/:token
Settings                   GET /settings, PATCH /settings (admin), GET /settings/public (theme, country, currency — for the SPA)
Audit                      GET /audit?entity=&entityId=&actorId=&from=&to=
Webhooks                   POST /webhooks/yeastar, GET|POST /webhooks/whatsapp
Health                     GET /health, GET /ready, GET /metrics (internal only)
```
