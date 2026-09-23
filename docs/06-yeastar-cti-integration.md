# 06 — Yeastar P-Series CTI Integration

Everything here is derived from Yeastar's P-Series Developer Guide (Cloud/Appliance/Software
editions share the same Open API v1.0). Primary sources:

- API interfaces & events summary: https://help.yeastar.com/en/p-series-appliance-edition/developer-guide/api-interfaces-and-events-summary.html
- Get token: https://help.yeastar.com/en/p-series-cloud-edition/developer-guide/get-access-token.html
- WebSocket events: https://help.yeastar.com/en/p-series-cloud-edition/developer-guide/monitor-events-via-websocket.html
- Webhook events: https://help.yeastar.com/en/p-series-appliance-edition/developer-guide/monitor-events-via-webhook.html
- 30011 Call State Changed: https://help.yeastar.com/en/p-series-cloud-edition/developer-guide/event-call-status-changed.html
- 30012 Call End Details (CDR): https://help.yeastar.com/en/p-series-cloud-edition/developer-guide/event-new-cdr.html
- 30016 Incoming Call Request: https://help.yeastar.com/en/p-series-cloud-edition/developer-guide/event-inbound-call-invitation.html
- Make a call: https://help.yeastar.com/en/p-series-cloud-edition/developer-guide/make-a-call.html
- Download recording: https://help.yeastar.com/en/p-series-cloud-edition/developer-guide/download-a-recording-file.html
- Linkus SDK for Web: https://help.yeastar.com/en/p-series-linkus-cloud-edition/linkus-sdk-guide/ (sign endpoint `POST /openapi/v1.0/sign/create`)

If the client's firmware differs, re-verify payloads against the PBX's own developer guide
(**Integrations → API → Developer Guide** link in the PBX portal) before changing schemas.

## 1. PBX prerequisites (client side)

1. P-Series **Enterprise or Ultimate Plan** active (API is not in Basic/Standard).
2. **Integrations → API**: enable, note **Client ID** and **Client Secret**.
3. **IP allowlist**: add the VPS egress IP (or the WireGuard peer IP). Keep it enabled.
4. **Extension Status Monitor**: enable _Call Status_ (and Registration/Presence) for **every agent extension** (this is what makes `30008`/`30011` fire for those extensions).
5. **Trunk Status Monitor** → enable **Control Inbound Call** on the external trunks → enables `30016` and `call/accept_inbound` / `call/refuse_inbound` (in-app Answer/Decline without WebRTC).
6. **Call recording** enabled for agent extensions / trunks; consent announcement configured.
7. (Optional) Webhook: **Integrations → API → Webhook**: URL `https://crm.<domain>/webhooks/yeastar`, method POST, note the 32-char secret; subscribe to the same event list as below. Used only as a fallback/secondary feed (see §6).
8. (Optional) **Linkus SDK** subscription if in-browser answering/softphone is required (AccessID/AccessKey are separate credentials).

## 2. Network reachability

The CRM **initiates** the WebSocket to the PBX and calls the REST API — the PBX must be reachable from the VPS:

| PBX edition                            | Path                                                                                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloud Edition                          | Public `https://<tenant>.<region>.yeastarcloud.com` — reachable directly; set PBX IP allowlist to the VPS IP.                                                                   |
| Appliance / Software Edition (on-prem) | **WireGuard** site-to-VPS tunnel. Worker connects to `https://<pbx-lan-ip>:8088` (or the PBX HTTPS port) over the tunnel. Never expose the PBX web port to the public internet. |

TLS: verification is never disabled; `NODE_TLS_REJECT_UNAUTHORIZED=0` is **forbidden**. Production must declare how the PBX is trusted:

| PBX certificate                                                             | Setting                                                                       |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Self-signed (typical appliance)                                             | pin it: `YEASTAR_TLS_FINGERPRINT_SHA256`, or supply it: `YEASTAR_TLS_CA_FILE` |
| Public CA (Yeastar Cloud, Remote Access `*.ras.yeastar.com`, Let's Encrypt) | `YEASTAR_TLS_PUBLIC_CA=true`, no pin                                          |

Never pin a public CA certificate: Let's Encrypt rotates roughly every ninety days and a pinned fingerprint severs telephony silently at the next renewal.

## 3. API contract (what the client wrapper implements)

Base: `{YEASTAR_BASE_URL}/openapi/v1.0`. Every request MUST send header `User-Agent: OpenAPI` (mandatory per Yeastar) and `Content-Type: application/json`. The access token is passed as query string `?access_token=`. Responses always carry `errcode` (0 = success) and `errmsg`.

| Purpose                           | Method & path                                                                                 | Body / params                                                                                              | Response                                                                                                |
| --------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Get token                         | `POST /get_token`                                                                             | `{ "username": <ClientID>, "password": <ClientSecret> }`                                                   | `{ access_token, access_token_expire_time: 1800, refresh_token, refresh_token_expire_time: 86400 }`     |
| Refresh                           | `POST /refresh_token`                                                                         | `{ "refresh_token" }`                                                                                      | same shape as above (new pair)                                                                          |
| Revoke                            | `GET /del_token?access_token=`                                                                | —                                                                                                          | `errcode`                                                                                               |
| Subscribe events                  | `WSS /subscribe?access_token=` then send `{"topic_list":[…]}`                                 | text `heartbeat` every ≤ 60 s → `heartbeat response`                                                       | events as JSON text frames `{ type, sn, msg }`                                                          |
| Dial                              | `POST /call/dial`                                                                             | `{ caller: <ext>, callee: <number>, dial_permission?: <ext>, auto_answer?: "yes"\|"no" }`                  | `{ call_id }`                                                                                           |
| Query live calls                  | `GET /call/query?call_id=`                                                                    | or `type=`/`extension=`                                                                                    | `{ data: [{ call_id, members[] }] }`                                                                    |
| Accept inbound (trunk-controlled) | `POST /call/accept_inbound`                                                                   | `{ channel_id, ... }`                                                                                      |                                                                                                         |
| Refuse inbound                    | `POST /call/refuse_inbound`                                                                   | `{ channel_id }`                                                                                           |                                                                                                         |
| Hangup                            | `POST /call/hangup`                                                                           | `{ channel_id }`                                                                                           |                                                                                                         |
| Hold / Unhold                     | `POST /call/hold`, `/call/unhold`                                                             | `{ channel_id }`                                                                                           |                                                                                                         |
| Mute / Unmute                     | `POST /call/mute`, `/call/unmute`                                                             | `{ channel_id }`                                                                                           |                                                                                                         |
| Transfer                          | `POST /call/transfer`                                                                         | `{ channel_id, type: "blind"\|"attended", number }`                                                        |                                                                                                         |
| Record control                    | `POST /call/record_start`, `/record_pause`, `/record_unpause`                                 | `{ channel_id }`                                                                                           |                                                                                                         |
| CDR list                          | `GET /cdr/list?page=&page_size=&sort_by=&order_by=` (+ `cdr/search` filters incl. time range) |                                                                                                            | `{ total_number, data: [CDR] }`                                                                         |
| Recording list/search             | `GET /recording/list`, `/recording/search`                                                    |                                                                                                            | `{ data: [{ id, file, … }] }`                                                                           |
| Recording download                | `GET /recording/download?id=` or `?file=`                                                     |                                                                                                            | `{ file, download_resource_url }` → `GET {base}{download_resource_url}?access_token=` within **30 min** |
| Extensions                        | `GET /extension/list`, `/extension/query?id=`                                                 |                                                                                                            | used to validate user↔extension mapping in admin UI                                                     |
| Linkus sign                       | `POST /sign/create`                                                                           | `{ username: <ext>, sign_type: "sdk", expire_time: <sec> }` (verify exact fields on the client's firmware) | `{ data: { sign } }` — handed to the browser SDK                                                        |

Exact request field names for call-control endpoints (`channel_id` vs `call_id`) MUST be verified against the client's firmware developer guide during step 0 of implementation; the wrapper isolates this in `integrations/yeastar/client.ts`.

## 4. Token lifecycle (`token-manager.ts`)

- The **worker** is the only process that calls `get_token`/`refresh_token`. It stores `{ accessToken, refreshToken, accessExpiresAt, refreshExpiresAt }` in Valkey key `cti:token` (JSON, no TTL) under a lock `cti:token:lock` (SET NX PX 10000).
- Refresh at `accessExpiresAt - 5 min` (i.e. every ~25 min). If refresh fails or `refreshExpiresAt` is near, do a fresh `get_token`.
- The **api** process reads `cti:token` for dial/control/recording calls. On `errcode` indicating an invalid token it publishes `cti:token:invalid` and returns `503 PBX_UNAVAILABLE`; the worker refreshes.
- On graceful shutdown the worker calls `del_token` (Yeastar caps an app at 8 simultaneous tokens; leaking tokens eventually blocks login).
- Client ID/Secret only ever exist in env (`YEASTAR_CLIENT_ID`, `YEASTAR_CLIENT_SECRET`).

## 5. WebSocket subscriber (`subscriber.ts`)

```
loop:
  acquire leader lock cti:leader (SET NX PX 15000, renew every 5 s) — if not leader, sleep 5 s, retry
  token = tokenManager.get()
  ws = connect wss://{host}/openapi/v1.0/subscribe?access_token={token}
  on open:  send {"topic_list":[30007,30008,30011,30012,30013,30015,30016,30033]}   (+30031,30032 if yeastar messaging channel enabled)
            expect {"errcode":0}
            start heartbeat timer: send "heartbeat" every 30 s; if no "heartbeat response" within 15 s → close
            publish pbx:status {connected:true}
            schedule reconcile(sinceLastCdrSeenAt)
  on message: if text == "heartbeat response" → mark alive
              else parse JSON → Zod-validate by `type` → persist pbx_events (async, batched) → dispatch(event)
  on close/error: publish pbx:status {connected:false}; backoff = min(30 s, 1 s * 2^n) + jitter; token may be refreshed; loop
```

Never block the socket `message` handler on the DB: dispatch runs on an in-process queue with concurrency 1 **per call_id** (ordering matters) and unlimited across calls.

## 6. Webhook receiver (fallback / dual feed)

`POST /webhooks/yeastar` on the api process:

1. Read **raw body**; compute `base64(HMAC_SHA256(rawBody, YEASTAR_WEBHOOK_SECRET))`; compare with header `X-Signature` using `crypto.timingSafeEqual`. Reject `401` on mismatch. Skip further processing for `{"event":"test"}` (return 200).
2. Enqueue to BullMQ `cti.event` with `jobId = sha256(rawBody)` (dedupes if both WS and webhook deliver the same event) and respond `200` immediately (< 100 ms — Yeastar's timeout is 3–10 s).
3. Worker processes it through the **same** `dispatch()` as WebSocket events.

Mode is selected by `YEASTAR_EVENT_SOURCE=websocket|webhook|both` (default `both` when a webhook secret is configured).

## 7. Event catalogue we consume

| type                  | Name                                                                                                                                                                                                                                                                                          | Use                                                                                                                                |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 30007                 | Extension Registration Status Changed                                                                                                                                                                                                                                                         | agent phone online/offline → `agent:presence` for managers; warn agent if their phone is unregistered                              |
| 30008                 | Extension Call State Changed `{ extension, status }`                                                                                                                                                                                                                                          | secondary signal; keeps `ext→busy/idle` map for manager dashboard                                                                  |
| **30011**             | Call State Changed `{ call_id, members: [ {extension\|inbound\|outbound\|internal: { number?, from?, to?, trunk_name?, channel_id, member_status, call_path }} ] }`                                                                                                                           | **primary** live signal: ringing, answered, hold, bye, per member with `channel_id` for control                                    |
| **30012**             | Call End Details `{ call_id, time_start, call_from, call_to, call_duration, talk_duration, src_trunk_name, dst_trunk_name, status: ANSWERED\|NO ANSWER\|BUSY\|VOICEMAIL\|ABANDONED, type: Inbound\|Outbound\|Internal, recording, did_number, did_name, agent_ring_time, uid, call_note_id }` | **final** record; idempotent upsert by `uid`                                                                                       |
| 30013                 | Call Transfer Report                                                                                                                                                                                                                                                                          | annotate Call (`transferred_to`), Activity meta                                                                                    |
| 30015                 | Call Failure Report                                                                                                                                                                                                                                                                           | mark outbound `failed` with reason (dial API failures)                                                                             |
| 30016                 | Incoming Call Request (trunk with Control Inbound Call)                                                                                                                                                                                                                                       | earliest possible ring signal for inbound (fires before extensions ring) → pre-warm contact lookup; enables Answer/Decline via API |
| 30033                 | Recording Download Completed                                                                                                                                                                                                                                                                  | informational; recordings are pulled by us anyway                                                                                  |
| 30031 / 30032 / 30038 | New Message / Sending Result / Read receipt                                                                                                                                                                                                                                                   | only when the Yeastar messaging channel adapter is enabled ([11](11-chat-integration.md))                                          |

`member_status` values: `ALERT` (ringback), `RING` (ringing), `ANSWERED`/`ANSWER` (talking), `HOLD`, `BYE`, `EARLYMEDIA` (outbound 183).

## 8. CTI state machine (`call-state.ts`)

State per call lives in Valkey hash `cti:call:{call_id}` (TTL 6 h, deleted on finalize):

```
{
  callId, direction: inbound|outbound|internal,
  externalRaw, externalE164, contactId?, companyId?,
  trunkName, didNumber, callPath,
  members: { [channel_id]: { kind: extension|inbound|outbound|internal, number, status, updatedAt } },
  ringingExtensions: [ext...], answeredExtension?, answeredAt?,
  poppedTo: [userId...], firstEventAt, crmCallId (uuid of calls row once created)
}
```

Direction detection from 30011 members:

- has `inbound` member → **inbound**; external = `inbound.from`; internal target(s) = extension members.
- has `outbound` member → **outbound**; external = `outbound.to`; agent = `outbound.from` (extension).
- only `extension`/`internal` members → **internal** (popup only if `Setting.popup.popOnInternalCalls`).

Transitions and side effects:

| Observed                                                           | Effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First event for `call_id` (30016 or 30011)                         | create state; normalize external number; lookup contact + company + recent activity (cache result in state) ; create `calls` row `status=ringing` (`pbx_call_id`), Activity is **not** written yet                                                                                                                                                                                                                                                                                                                        |
| extension member → `RING` (inbound) or `ALERT` (outbound ringback) | map extension → user (Valkey hash `cti:ext2user`); emit `call:ringing` to `user:{id}` if not already in `poppedTo`; record `pop_latency_ms`; create `Notification(call_incoming)`                                                                                                                                                                                                                                                                                                                                         |
| extension member → `ANSWERED`/`ANSWER`                             | set `answeredExtension`, `answeredAt`; `calls.user_id`, `answered_at`, `status=answered`; emit `call:answered` to that user and `call:cancelled` (reason `answered_elsewhere`) to other popped users                                                                                                                                                                                                                                                                                                                      |
| member → `HOLD` / back to `ANSWERED`                               | emit `call:updated { hold: true/false }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| extension member → `BYE` or all members `BYE`                      | emit `call:ended` to popped users (payload includes `crmCallId` so the UI can show the disposition form); keep state until CDR                                                                                                                                                                                                                                                                                                                                                                                            |
| **30012 CDR** (`uid`)                                              | upsert `calls` by `pbx_cdr_uid` (fallback match by `pbx_call_id`); map `status`: ANSWERED→`completed`, NO ANSWER→`missed` (inbound) / `failed` (outbound), BUSY→`busy`, VOICEMAIL→`voicemail`, ABANDONED→`abandoned`; durations; `recording_file_name` → `recording_status=pending` + enqueue download; write **Activity(call)**; emit `call:logged`; if missed inbound → `Notification(call_missed)` to owner/ringing users; if `Setting.popup.suggestFollowUpAfterCall` → payload `suggestFollowUp: true`; delete state |
| CDR arrives with no prior state (event gap)                        | create the call fully from CDR (direction from `type`, external from `call_from`/`call_to`)                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 30013 transfer                                                     | update `calls.call_path`/meta, Activity meta `transferredTo`                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 30015 failure                                                      | mark `failed`, `error` meta                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

Queue / ring-group calls ring several extensions at once: every mapped user gets a pop; the first `ANSWERED` cancels the others.

## 9. Number normalization & matching (`normalize.ts`)

```
normalize(raw):
  strip spaces/dashes/parentheses
  if raw matches internal extension pattern (Setting.dialRules.internalExtensionLength) → { kind: 'extension' }
  parsePhoneNumber(raw, Setting.defaultCountry) with libphonenumber-js
    → if valid: e164
    → else if raw starts with '00': try '+' + raw.slice(2)
    → else: e164 = null (keep raw only)
match(e164):
  ContactPhone where e164 = $1 and deleted_at is null  (index hit)
  else Company where phone_e164 = $1
  else if Setting.matching.allowSuffixMatch: ContactPhone where e164 like '%' || right($1, 9) → candidates (UI shows "possible matches")
```

Anonymous/withheld caller IDs (`anonymous`, `unknown`, empty) → `contact: null`, `callerNumber: null`, popup says "Withheld number".

## 10. Click-to-call rules

- Actor must have permission `call:dial` and a non-null `users.extension`.
- `callee` is derived: E.164 → dialable via `Setting.dialRules` (`e164ToDialable: national` → `07XXXXXXXX` for KE; `international` → `+254…` or `00254…`; prefix prepended if trunks need one).
- Optional `dial_permission` = a supervisor extension configured in `Setting.dialRules.dialPermissionExtension` (used when the agent's extension lacks outbound permission on the PBX).
- Rate limit: 10 dials / minute / user.
- Response `202 { callId, pbxCallId }`. The popup opens in "dialing" state immediately from the HTTP response, then follows 30011 events.
- Contacts with `do_not_call=true` → `409 DO_NOT_CALL` unless actor has `contact:override_dnc`.

## 11. In-app call controls (R-4.3) — capability flags

`GET /api/v1/cti/capabilities` returns what the deployment supports, computed from env + PBX features:

| Control                   | Mechanism                                                                                                                          | Condition                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Hang up                   | `call/hangup { channel_id }` of the agent's extension member                                                                       | always (Open API)                                                           |
| Hold / Resume             | `call/hold` / `call/unhold`                                                                                                        | always                                                                      |
| Mute / Unmute             | `call/mute` / `call/unmute`                                                                                                        | always                                                                      |
| Transfer (blind/attended) | `call/transfer`                                                                                                                    | always                                                                      |
| Answer                    | (a) `call/accept_inbound` for trunk-controlled inbound (30016) — rings the extension's device, or (b) Linkus WebRTC SDK in browser | (a) `Control Inbound Call` enabled; (b) `LINKUS_SDK_ENABLED=true` + license |
| Decline                   | `call/refuse_inbound`                                                                                                              | Control Inbound Call enabled                                                |

Every control call is audited (`call.control.<action>`), permission `call:control`, and validated so an agent can only control calls where they are a member (managers/admins may control any).

## 12. Linkus WebRTC SDK (optional, P2)

- Backend: `POST /api/v1/cti/linkus-sign` → permission `call:webrtc` → Yeastar `POST /sign/create` for the user's extension → returns `{ sign, pbxUrl, username }` (short expiry). AccessID/AccessKey for the SDK live in env and are never sent to the browser.
- Frontend initializes `ys-webrtc-sdk-core` with that sign; incoming-call events from the SDK are reconciled with our `call:ringing` by `call_id` (the CRM popup remains the UI; the SDK provides the audio path + answer).

## 13. Reconciliation (`reconcile.ts`)

Runs (a) after every WebSocket (re)connect, (b) every 10 min by cron, (c) on demand by admins:

1. `since = Setting/state lastCdrSeenAt - 5 min` (persisted in Valkey + DB).
2. Page through `cdr/search` (time range) → for each CDR: upsert by `uid` using the same `applyCdr()` as event 30012 (so behavior is identical).
3. Recordings missing locally but present on PBX → enqueue downloads.
4. Report `{ inserted, updated, skipped }` to logs/metrics.

## 14. Latency budget (R-4.1.1)

| Segment                                                                                               | Budget                             |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------- |
| PBX emits 30011 → worker receives (WireGuard/LAN or cloud)                                            | ≤ 150 ms                           |
| Zod parse + state update (Valkey)                                                                     | ≤ 10 ms                            |
| Extension→user map (Valkey hash, warm)                                                                | ≤ 2 ms                             |
| Contact + company + last-5 activity lookup (indexed, single round trip via one SQL with lateral join) | ≤ 40 ms                            |
| Emit via Valkey adapter → api → browser                                                               | ≤ 60 ms                            |
| Browser render                                                                                        | ≤ 50 ms                            |
| **Typical total**                                                                                     | **≈ 300 ms** (hard limit 2 000 ms) |

`cti.pop_latency_ms` histogram is exported; alert at p95 > 1 000 ms.

## 15. Testing the integration without a PBX

- `test/fixtures/yeastar-events/*.json`: recorded sequences (inbound answered, inbound missed, outbound, queue ring 3 extensions, transfer, CDR-only gap).
- `YeastarClient` is an interface; `FakeYeastarServer` (in-repo, `ws` + Fastify) replays fixtures and records calls to `dial`/control endpoints for integration tests.
- A **PBX simulator** CLI (`pnpm cti:simulate inbound +254712345678 --ext 1001`) drives the same pipeline in dev.

## 16. Operational checks

- `/ready` includes `pbx: { connected, lastEventAt, tokenExpiresAt, leader }`.
- Admin UI "PBX status" page shows the same + last 50 raw events + a "reconcile now" button.
- Alert if no heartbeat response for 60 s, or `connected=false` for > 2 min.

## 17. Contact sync (`jobs/contact-sync.ts`)

The PBX's company contacts and the CRM's contacts are kept as the same set of people, in both
directions. Off by default: `contactSync.enabled` in settings, with `contactSync.phonebookName`
naming the phonebook. Requires `telephony` in the plan.

**Reconciled, not hooked.** Every run reads both sides, plans the difference and applies it, the
way `reconcile.ts` does for CDRs. A contact changes through a dozen paths, including the CSV
import, a lead being converted, a merge and every phone endpoint, so a sync built from hooks on
those paths is correct only until somebody adds the thirteenth. Scheduled every ten minutes from
the worker; the interval is how stale a phonebook may be, not how reliable the sync is.

**Matching is by phone number, never by name.** Numbers are compared as E.164, and the CRM's
partial unique index guarantees one live contact per number, so a number identifies at most one
person on each side. This is what stops a second run creating a second copy of everybody, and what
lets a first run against a PBX that was already in use adopt its entries rather than duplicate
them.

**Who wins.** The CRM is the record of the business, so it wins on content. A contact only the PBX
has is imported rather than deleted: somebody typed them into a phone, and deleting their work is
not a sync. Imported contacts are unowned, so every agent can see them until an admin assigns them,
and carry `source = 'yeastar'`.

**Deleting is deliberately asymmetric.** Deleting in the CRM deletes on the PBX. Deleting on the
PBX does not delete in the CRM; the contact is put back on the next run. A handset should not be
able to destroy the business's own records.

**Phonebook consistency.** The phonebook is created with `member_select: 'sel_all'`, so it holds
every company contact by construction. A phonebook that named its members would need editing on
every change, and the day that edit failed the phonebook and the contacts would disagree.

**Shape mismatch.** Numbers are written as a `number_list` array and read back as one field per
slot (`mobile`, `business`, `home` and their seconds), so the mapping is written twice. Seven slots
are filled, most useful first; an eighth number is dropped rather than failing the contact. A
contact with no number at all is skipped, because the PBX cannot hold one.

**Cost and failure.** A run that changes nothing costs two requests. `fingerprint` records what was
last written, so an unchanged contact is never re-sent, and fields the PBX cannot hold (tags,
owner) do not count as changes. Writes are capped at 300 per run so a first sync of a large CRM is
spread over several runs. Each contact is applied on its own: one refusal is counted and retried
next run rather than stopping the rest.

| Endpoint                                        | Used for                                              |
| ----------------------------------------------- | ----------------------------------------------------- |
| `GET /company_contact/list`                     | reading the PBX side, 1 000 per page                  |
| `POST /company_contact/create`                  | a CRM contact the PBX does not have                   |
| `POST /company_contact/update`                  | one the PBX has, out of date                          |
| `GET /company_contact/delete`                   | one deleted in the CRM (single id only; no bulk form) |
| `GET /phonebook/list`, `POST /phonebook/create` | making sure the phonebook exists                      |

## 18. Who is which extension (`jobs/extension-sync.ts`)

A call pops for a person, and is logged against a person, through one lookup: the ringing
extension's number, looked up in the extension map built from `users.extension` (§8). Both the
popup and the call record read that same map, so they agree by construction. What used to be weak
was how the map was filled: somebody typed an extension into a profile, and a blank or mistyped one
failed silently. That person's calls popped for nobody and were logged against nobody.

This is the rule Yeastar's own CRM integration applies with "Associate Automatically": an extension
and a user account with the same email are the same person. `GET /extension/list` returns
`email_addr` for every extension, and every CRM user has an email, so it is the one key that needs
no maintenance on either side.

**What it does, and only this.** Every ten minutes from the worker, and on the "Match now" button
under Settings → Telephony, it reads the PBX's extensions and the CRM's active users and fills in an
extension on any user who has none, when exactly one extension carries their email and nobody else
holds it. Then it refreshes the extension map, so the next call pops correctly.

**What it never does.** Change an extension somebody set. Give one extension to two people. Guess
between two extensions with the same email. Each of those is reported with a sentence saying what
to decide, because a wrong guess sends a person's calls to the wrong desk, which is quieter and
worse than a blank.

**What the report shows.** Users with no extension (no popups, nothing logged to them), extensions
on the PBX that belong to nobody here, and conflicts. The last report is kept in Valkey under
`cti:extension-links:last` so the screen reads it without asking the PBX.

**What it does not do: routing.** Which extensions ring is decided by the inbound route, ring group
or queue on the PBX. If every agent's phone rings, that is a ring group; the CRM pops only for
extensions that ring (`call-state.ts`), never for everyone.

Switched on by default (`extensionSync.enabled`), because filling a blank from an exact match is
safe and the alternative is the silent failure above.
