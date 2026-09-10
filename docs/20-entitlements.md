# 20. Entitlements: what a customer may use

Every customer runs their own stack. What that stack allows is decided outside it, by a signed
document the customer cannot edit and their administrator cannot override. This document is the
contract: what the switches are, how the document travels, and how a stack enforces it.

With no owner console configured a stack uses built-in defaults, which is everything on and no
limits. That is how the pilot deployment runs, and nothing here changes it.

## 1. The catalogue

`packages/shared/src/entitlements.ts` is the single source of truth. The API validates against it,
the console edits it, and the customer's app reads it; adding a feature key means adding it there
and nowhere else.

**Core, never switchable.** Signing in, two-factor, profiles, users and teams, contacts, companies,
notes and attachments, tasks and reminders, the timeline, notifications, general settings, reading
the audit log, search, the command palette, and the manual. Selling a CRM that cannot do these is
not selling a CRM.

**Features.** Each is a boolean. A feature with a prerequisite is off whenever its prerequisite is
off, whatever the stored value says.

| Key             | What goes away when it is off                                                              | Needs       |
| --------------- | ------------------------------------------------------------------------------------------ | ----------- |
| `telephony`     | Call popup, dialpad, click to call, live calls, call history, outcomes, Telephony settings |             |
| `recordings`    | Recording playback, retention setting, deletion                                            | `telephony` |
| `softphone`     | Answering in the browser                                                                   | `telephony` |
| `messaging`     | Inbox, channels, WhatsApp webhooks, templates                                              |             |
| `leads`         | Leads and conversion                                                                       |             |
| `webforms`      | Public lead-capture forms                                                                  | `leads`     |
| `deals`         | Deals board and list, pipelines, stages, forecast                                          |             |
| `reports`       | The reports screen, own scope only                                                         |             |
| `reports_team`  | Team and company-wide scopes, and the manager's home board                                 | `reports`   |
| `exports`       | CSV export everywhere                                                                      |             |
| `imports`       | The CSV import wizard                                                                      |             |
| `custom_fields` | Custom fields on every entity                                                              |             |
| `audit_diff`    | Before and after values on audit rows                                                      |             |
| `backups`       | Self-service snapshot list, download and upload                                            |             |
| `api_docs`      | The OpenAPI reference                                                                      |             |

Switching a feature off hides it and refuses its routes. It never deletes anything: switching it
back on restores what was there.

**Limits.** `seats` (active users, a hard cap on creating or reactivating), `storage_gb`
(attachments, recordings and backups together), `recording_retention_days` (a ceiling on the
customer's own setting), `channels`, `pipelines`. `null` means no limit.

**Expiry.** `expiresAt` is write-refusal, not a lock-out. Signing in and reading keep working;
every write is refused with a banner naming who to call. Webhooks and public forms keep accepting
data, so nothing is lost while a renewal is sorted out.

## 2. The document

```jsonc
{
  "version": 1,
  "customerId": "…",
  "customerName": "Acme Call Centre",
  "plan": { "id": "…", "name": "Standard" },
  "features": { "telephony": true, "recordings": true, … },
  "limits": { "seats": 10, "storage_gb": 20, … },
  "expiresAt": null,
  "issuedAt": "2026-09-10T00:40:51.140Z",
  "issuer": "https://console.raniafrica.co.ke",
  "audience": "stk_ibdfndrsyomfzwr3pzkb",
  "ownerContact": { "name": "…", "email": "…", "phone": "…" }
}
```

`audience` is what stops a document issued for one customer being replayed onto another's server.
`ownerContact` travels inside it so a locked screen can say who to call without the stack needing
to know anything about the provider.

## 3. Signing

Ed25519. The envelope is `{ payload, signature, keyId }`, all base64url.

The bytes that are signed are exactly `base64url-decode(payload)`. Neither side ever re-serialises
the JSON, so no difference in key order or spacing between two runtimes can invalidate a document.
`keyId` is the first 16 hex characters of the SHA-256 of the SPKI DER encoding, which lets a stack
hold more than one trusted key while a key is being rotated.

The console holds the only private key (`CONSOLE_SIGNING_KEY`). A stack holds the public half
(`CONSOLE_PUBLIC_KEY`, a comma-separated list during rotation) and refuses anything else. The two
implementations are checked against each other by a test that imports the stack's verifier into the
console's suite (`apps/console-api/test/unit/signing.test.ts`).

## 4. How a stack gets one

Three ways, in order of precedence:

1. **The owner console.** The worker keeps an outbound websocket open (docs/21). A document arrives,
   is verified, applied and acknowledged. At boot, before the socket, one HTTP request asks for
   anything issued while the stack was down.
2. **A file.** `ENTITLEMENTS_FILE` points at a signed envelope on disk, for an air-gapped
   deployment. It still needs `CONSOLE_PUBLIC_KEY`, and it can be reloaded from Settings.
3. **Defaults.** Nothing configured: everything on, no limits, never expires.

Applying is a transaction: the `Entitlement` row, an append-only `EntitlementHistory` row and an
audit entry, then a Valkey publish that clears the ten second cache in every process, then a
`entitlements:changed` socket event so open browsers update without a reload.

A document is refused, and the refusal audited, when the envelope is malformed, the signature does
not verify, the key is unknown, the audience is another stack, or `issuedAt` is older than the
document already in force. A refusal never changes what is in force.

## 5. Enforcement

One place: the `preValidation` hook in `apps/api/src/plugins/authorize.ts`, immediately after the
permission check. A route declares what it needs:

```ts
config: { auth: { permission: 'call:read', feature: 'telephony' } }
```

- A feature that is off → `FEATURE_NOT_IN_PLAN`, **403**.
- An expired plan on a write → `PLAN_EXPIRED`, **403**. Reads, sign-in, the profile and
  `/entitlements` itself are unaffected.
- A limit reached → `LIMIT_REACHED`, **409**, with `details { limit, used, max }`. 409 rather than
  403 because freeing a seat makes the identical request succeed, which is the same reasoning
  `DUPLICATE` and `STALE_VERSION` follow (docs/09).

All three are audited as `access.denied`. Permission denials are audited the same way.

A suspension arrives as this and nothing more: the console reissues the document with an expiry of
now (docs/21 §5), so the customer keeps every record and loses only the ability to add to them.

The web app reads `GET /entitlements` once, subscribes to `entitlements:changed`, and hides what is
not included: navigation items, buttons, whole screens. Hiding is a courtesy; the server is what
decides.

## 6. Usage accounting

Seats are counted from active users. Storage is a running total in Valkey
(`entitlements:usage:storage`), adjusted as objects are written and removed, recomputed nightly by
the retention job and whenever the counter is missing. The recount survives an unreachable object
store: the database figures are still right and the backup total keeps its last value, because a
stack with a sick disk must still be able to report how it is doing.

## 7. What this does not do

It does not make the CRM multi-tenant. One stack, one customer, one database. The document travels
between two services and is enforced in one hook, so the same layer would work unchanged if a
tenant ever became a row instead of a server.
