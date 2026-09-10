# CRM + Yeastar PABX (CTI) — Engineering Documentation

This directory is the **single source of truth** for how this system is designed and built.
Every implementation decision must trace back to a document here. If something is not
covered, add it here first, then build it. If code and docs disagree, the docs win until the
docs are deliberately changed.

Source requirement: `CRM_PABX_System_Requirements.md` (v1.0). The PBX is confirmed as
**Yeastar P-Series**. Hosting is a **Linux VPS** running **Docker**. No Supabase, no Clerk.

## Reading order

| #   | Document                                                             | What it locks down                                                                                                     |
| --- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 01  | [Requirements traceability](01-requirements-traceability.md)         | Every requirement in the spec → module, phase, status. Nothing gets built that is not here; nothing here gets skipped. |
| 02  | [Technology stack](02-stack.md)                                      | Exact stack, versions, and _why_; explicitly rejected options.                                                         |
| 03  | [Architecture](03-architecture.md)                                   | Processes, boundaries, data flows (screen pop, click-to-call, recording, chat), diagrams.                              |
| 04  | [Repository structure](04-repo-structure.md)                         | Monorepo layout, backend module layout, file naming.                                                                   |
| 05  | [Data model](05-data-model.md)                                       | Every entity, field, relation, index, constraint.                                                                      |
| 06  | [Yeastar CTI integration](06-yeastar-cti-integration.md)             | PBX API contract, event handling state machine, token lifecycle, reconnection, reconciliation.                         |
| 07  | [Authentication & RBAC](07-auth-rbac.md)                             | Better Auth configuration, roles, permission matrix, record-level visibility.                                          |
| 08  | [Security rules](08-security-rules.md)                               | Non-negotiable security controls for code and infrastructure.                                                          |
| 09  | [API conventions](09-api-conventions.md)                             | REST shape, validation, errors, pagination, idempotency, OpenAPI.                                                      |
| 10  | [Realtime contract](10-realtime-contract.md)                         | Socket.IO namespaces, rooms, event names and payloads.                                                                 |
| 11  | [Chat integration](11-chat-integration.md)                           | Channel adapter interface; WhatsApp Cloud API; Yeastar messaging; SMS.                                                 |
| 12  | [Infrastructure & Docker](12-infrastructure-docker.md)               | Compose topology, Caddy TLS, volumes, hardening, ops runbook.                                                          |
| 13  | [Backup & recovery](13-backup-recovery.md)                           | RPO/RTO, restic + pg_dump, recordings backup, restore drills. "Data must not be lost."                                 |
| 14  | [Engineering rules](14-engineering-rules.md)                         | Coding standards, module boundaries, error handling, logging, testing, git.                                            |
| 15  | [Implementation plan](15-implementation-plan.md)                     | Ordered build steps for the backend with definition-of-done per step.                                                  |
| 16  | [Open questions & assumptions](16-open-questions-and-assumptions.md) | Client questions from spec §10 with the defaults we build against until answered.                                      |
| 17  | [Frontend guidelines](17-frontend-guidelines.md)                     | Vite/React app rules (built after the backend).                                                                        |
| 20  | [Entitlements](20-entitlements.md)                                   | What a customer may use: the catalogue, the signed document, and where it is enforced.                                 |
| 21  | [Owner console](21-owner-console.md)                                 | The provider's own service: customers, plans, the fleet, and the link every stack dials home on.                       |
| 22  | [Help manual](22-help-manual.md)                                     | The manual inside the product: how its content, figures and printing work.                                             |

## Non-negotiables (summary — details in the linked docs)

1. **Screen pop ≤ 2 s from ring start** (spec §4.1, §8). The CTI path is event-driven end to end; no polling in the hot path. [03](03-architecture.md), [06](06-yeastar-cti-integration.md)
2. **Every call is logged** — inbound, outbound, missed, internal — idempotently keyed on the PBX CDR `uid`, with reconciliation after any disconnect. [06](06-yeastar-cti-integration.md)
3. **One unified timeline per contact** backed by the `Activity` table; every module writes to it. [05](05-data-model.md)
4. **Security by default**: TLS everywhere, httpOnly cookie sessions, RBAC + record-level scoping enforced server-side, all input validated with Zod, all webhooks signature-verified, secrets never in the repo. [08](08-security-rules.md)
5. **No data loss**: persistent named volumes, nightly encrypted off-site backups of DB + recordings + attachments, tested restores, soft deletes on business records, append-only audit log. [13](13-backup-recovery.md)
6. **Phone numbers are stored in E.164** and matched in E.164. Always. [05](05-data-model.md), [06](06-yeastar-cti-integration.md)
7. **Backend is a separate deployable** from the frontend; the frontend only talks to `/api` and `/socket.io` on the same origin. [03](03-architecture.md)

## Document conventions

- "MUST / MUST NOT / SHOULD" have RFC 2119 meaning.
- Code identifiers are `camelCase` in TypeScript and `snake_case` in PostgreSQL (mapped via Prisma `@map`).
- Diagrams are Mermaid (render in GitHub/VS Code) with an ASCII fallback where useful.
- Anything marked **CONFIRM WITH CLIENT** has a default we build against listed in [16](16-open-questions-and-assumptions.md).
