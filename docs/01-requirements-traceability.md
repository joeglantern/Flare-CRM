# 01 — Requirements Traceability Matrix

Every line of the requirements spec, mapped to where and when it is built. Use the ID in
commit messages, PR titles and tests (e.g. `feat(cti): R-4.1.1 screen pop on inbound ring`).

Phases follow spec §11: **P1** Core CRM + screen pop + call logging; **P2** Chat + unified
timeline polish; **P3** Advanced reporting, email integration, automation, mobile.

Backend module names refer to `apps/api/src/modules/<name>` (see [04](04-repo-structure.md)).

## §3 High-level architecture

| ID    | Requirement                                                                                   | Implementation                                                                                                   | Phase |
| ----- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----- |
| R-3.1 | Responsive web app with persistent call/chat popup on every page                              | `apps/web` app shell hosts a global `CallPopup` + `ChatDock` mounted outside the router outlet, fed by Socket.IO | P1    |
| R-3.2 | REST API, business logic, auth, integration middleware                                        | `apps/api` (Fastify) — REST (`/api/v1`), Better Auth (`/api/auth`), integration adapters                         | P1    |
| R-3.3 | Relational DB                                                                                 | PostgreSQL 17 via Prisma 7                                                                                       | P1    |
| R-3.4 | PABX integration layer listening to PBX events, pushing to frontend via WebSockets            | `worker` process: Yeastar WebSocket subscriber (+ webhook receiver fallback) → Valkey pub/sub → Socket.IO        | P1    |
| R-3.5 | Chat integration layer normalizing all channels into one conversation model tied to a contact | `modules/messaging` with `ChannelAdapter` interface; `Conversation`/`Message` tables                             | P2    |
| R-3.6 | S3-compatible object storage for recordings and attachments                                   | SeaweedFS S3 gateway (self-hosted) or external S3; accessed via `@aws-sdk/client-s3` through `modules/storage`   | P1    |

## §4 PABX / CTI

| ID      | Requirement                                                                                                     | Implementation                                                                                                                                                                                                                                       | Phase                                              |
| ------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| R-4.1.1 | Inbound call → popup within 2 s of ring start                                                                   | Yeastar event `30011` (member `RING` on agent extension) → contact lookup by E.164 → `call:ringing` socket event to `user:{id}` room. Latency budget in [06](06-yeastar-cti-integration.md#latency-budget)                                           | P1                                                 |
| R-4.1.2 | Popup shows name & company                                                                                      | `call:ringing` payload includes `contact { id, displayName, company }`                                                                                                                                                                               | P1                                                 |
| R-4.1.3 | Popup shows avatar                                                                                              | `contact.avatarUrl` (signed URL from storage)                                                                                                                                                                                                        | P1                                                 |
| R-4.1.4 | Last 5 interactions (calls + chats + notes) most recent first                                                   | Payload includes `recentActivity[5]` from `Activity` table                                                                                                                                                                                           | P1                                                 |
| R-4.1.5 | Quick actions: Answer, Open Profile, Create Note, Create Task, Log Disposition                                  | Frontend actions → `POST /calls/:id/answer` (capability-gated), routes, `POST /notes`, `POST /tasks`, `PATCH /calls/:id/disposition`                                                                                                                 | P1                                                 |
| R-4.1.6 | Unknown caller popup with quick-create contact                                                                  | Payload `contact: null` + `callerNumber`; `POST /contacts` with `phones[]` pre-filled; call re-linked on creation                                                                                                                                    | P1                                                 |
| R-4.1.7 | Outbound click-to-call from contact record                                                                      | `POST /calls/dial { contactId, phoneId }` → Yeastar `POST /call/dial { caller: user.extension, callee }`                                                                                                                                             | P1                                                 |
| R-4.2.1 | Every call (in/out/missed) auto-logged with timestamp, direction, duration, agent/extension, disposition, notes | `Call` table populated from live events + finalized from CDR event `30012` (idempotent on `uid`)                                                                                                                                                     | P1                                                 |
| R-4.2.2 | Disposition dropdown with configurable types                                                                    | `CallDisposition` table (seeded: Interested, Follow-up, No answer, Not interested + custom)                                                                                                                                                          | P1                                                 |
| R-4.2.3 | Link/embed to call recording                                                                                    | Recording pulled from PBX (`/recording/download`) into object storage; served via short-lived signed URL; `GET /calls/:id/recording`                                                                                                                 | P1                                                 |
| R-4.2.4 | Call history in one continuous timeline merged with chats/notes                                                 | `Activity` rows of type `call`                                                                                                                                                                                                                       | P1                                                 |
| R-4.3   | Optional in-app controls: Answer, Hang up, Hold, Transfer, Mute                                                 | Yeastar Open API `call/hangup`, `call/hold`, `call/unhold`, `call/mute`, `call/unmute`, `call/transfer` via `channel_id`; Answer via `call/accept_inbound` (trunk-controlled calls) or Linkus WebRTC SDK (licensed). Capability flags per deployment | P1 (hangup/hold/mute/transfer), P2 (WebRTC answer) |
| R-4.4.1 | Integrate via vendor Call Control API, matching Caller ID to CRM contacts                                       | Yeastar P-Series Open API (REST + WebSocket events) — see [06](06-yeastar-cti-integration.md)                                                                                                                                                        | P1                                                 |
| R-4.4.2 | All events pushed to the frontend in real time via WebSockets (Socket.IO)                                       | Socket.IO 4 on the API process, Valkey adapter/emitter for the worker                                                                                                                                                                                | P1                                                 |

## §5 Chat integration

| ID    | Requirement                                                       | Implementation                                                                                                                                                                   | Phase |
| ----- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| R-5.1 | At least one chat channel (confirm which)                         | `ChannelAdapter` interface; first adapter: **WhatsApp Business Cloud API** (default assumption); alternative adapter: **Yeastar PBX messaging** (event `30031` / `message/send`) | P2    |
| R-5.2 | Match messages to contact by phone/email, log in unified timeline | `Conversation.contactId` resolved by E.164 / email; `Activity` type `message`                                                                                                    | P2    |
| R-5.3 | Agents reply from within the CRM (2-way)                          | `POST /conversations/:id/messages` → adapter `send()`; delivery status via webhook                                                                                               | P2    |
| R-5.4 | Store full transcripts with timestamps and attachments            | `Message` + `Attachment` (object storage)                                                                                                                                        | P2    |

## §6 Unified 360° contact view

| ID    | Requirement                                                                    | Implementation                                                         | Phase                                                     |
| ----- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | --------------------------------------------------------- |
| R-6.1 | Single merged timeline: calls, chats, notes, emails, tasks, deal stage history | `Activity` table written by every module; `GET /contacts/:id/timeline` | P1 (calls, notes, tasks, deals) / P2 (chats) / P3 (email) |
| R-6.2 | Filterable by type, searchable                                                 | `?types=call,message&q=` — `Activity.searchVector` (tsvector GIN)      | P1                                                        |

## §7 Core CRM

| ID      | Requirement                                                                | Implementation                                                                                                                                       | Phase                  |
| ------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| R-7.1.1 | CRUD contacts & companies                                                  | `modules/contacts`, `modules/companies`                                                                                                              | P1                     |
| R-7.1.2 | Client-configurable custom fields                                          | `CustomFieldDefinition` + `customFields` JSONB validated against definitions at write time                                                           | P1                     |
| R-7.1.3 | Contact ownership (agents/teams)                                           | `Contact.ownerId`, `Team`, visibility rules in [07](07-auth-rbac.md)                                                                                 | P1                     |
| R-7.1.4 | De-dup on phone/email at create                                            | Partial unique indexes on `ContactPhone.e164` / `ContactEmail.email`; `GET /contacts/duplicates?phone=&email=` pre-check; `409 DUPLICATE` with match | P1                     |
| R-7.1.5 | CSV import/export                                                          | `modules/import-export` (streamed, BullMQ job, row-level error report)                                                                               | P1                     |
| R-7.2.1 | Lead capture: manual, web form, import                                     | `Lead` entity; public `POST /public/forms/:token` with origin allowlist + rate limit; CSV import                                                     | P1                     |
| R-7.2.2 | Configurable pipeline stages                                               | `Pipeline`, `PipelineStage` (ordered, probability, won/lost type)                                                                                    | P1                     |
| R-7.2.3 | Drag-and-drop / list deal management                                       | `PATCH /deals/:id/stage` + `DealStageHistory`; frontend Kanban                                                                                       | P1                     |
| R-7.2.4 | Deal value, expected close date, probability, owner                        | `Deal` fields                                                                                                                                        | P1                     |
| R-7.3.1 | Tasks with due dates, reminders, assignment                                | `Task` + BullMQ delayed reminder jobs                                                                                                                | P1                     |
| R-7.3.2 | Calendar view                                                              | `GET /tasks?from=&to=` (frontend calendar)                                                                                                           | P1                     |
| R-7.3.3 | Automatic task suggestion after a call                                     | On `call:ended` the popup offers "Schedule follow-up" prefilled; server `POST /tasks` with `sourceCallId`                                            | P1                     |
| R-7.4.1 | Free-text notes on contact/deal                                            | `Note` (also attachable to company, call)                                                                                                            | P1                     |
| R-7.4.2 | Full audit log per record (who/what/when)                                  | `AuditLog` append-only; `GET /audit?entity=&entityId=`                                                                                               | P1                     |
| R-7.5.1 | RBAC: Admin, Manager, Agent                                                | Better Auth admin plugin with custom access control                                                                                                  | P1                     |
| R-7.5.2 | Managers see all team activity; agents only assigned (configurable)        | `Setting.agentVisibility` ∈ `owned \| team \| all`; enforced in repository layer                                                                     | P1                     |
| R-7.5.3 | Email+password login; SSO later                                            | Better Auth email/password + TOTP 2FA; `sso` plugin (OIDC/SAML) reserved for P3                                                                      | P1                     |
| R-7.6.1 | Call reports: volume, AHT, missed, agent performance                       | `modules/reports` SQL aggregates over `Call`                                                                                                         | P1 basic / P3 advanced |
| R-7.6.2 | Pipeline reports: conversion, won/lost, forecast                           | Aggregates over `Deal`, `DealStageHistory`                                                                                                           | P1 basic / P3 advanced |
| R-7.6.3 | Exportable CSV/PDF                                                         | CSV P1; PDF P3                                                                                                                                       | P1/P3                  |
| R-7.7.1 | In-app notifications: incoming call, new chat, task due, deal stage change | `Notification` table + `notification:new` socket event                                                                                               | P1                     |
| R-7.7.2 | Optional email notifications                                               | `NotificationPreference` + Nodemailer via BullMQ `email` queue                                                                                       | P1                     |

## §8 Non-functional

| ID    | Requirement                                            | Implementation                                                                                                                    | Phase |
| ----- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ----- |
| R-8.1 | Screen pop ≤ 2 s                                       | See R-4.1.1; measured and logged (`cti.pop_latency_ms` metric)                                                                    | P1    |
| R-8.2 | Support N concurrent agents (**CONFIRM**)              | Design target 100 agents / 50 concurrent calls on one VPS; horizontally scalable via Valkey adapter                               | P1    |
| R-8.3 | 99.5 % uptime                                          | Docker restart policies, health checks, worker auto-reconnect, monitoring/alerts                                                  | P1    |
| R-8.4 | Encryption at rest and in transit; RBAC                | Caddy TLS 1.2+/HSTS; LUKS or provider disk encryption; encrypted backups (restic); secrets encrypted at column level where stored | P1    |
| R-8.5 | Recording consent compliance (Kenya DPA — **CONFIRM**) | Consent announcement configured on PBX; retention policy setting; recording access permission + audit                             | P1    |
| R-8.6 | Daily automated backups of DB and recordings           | restic nightly to off-site S3, retention 7d/4w/12m, weekly restore drill                                                          | P1    |
| R-8.7 | Latest Chrome/Edge/Firefox/Safari                      | Vite build targets; no Chrome-only APIs                                                                                           | P1    |
| R-8.8 | Desktop + tablet                                       | Responsive layout ≥ 768 px                                                                                                        | P1    |

## §9 Data model

All entities in §9 exist with the fields listed, extended as documented in [05](05-data-model.md).

## §10 Open questions

Tracked in [16](16-open-questions-and-assumptions.md) with the working default for each.
