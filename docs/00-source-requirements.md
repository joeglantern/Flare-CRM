# System Requirements Specification
## CRM with PABX (CTI) Integration and Unified Communication History

**Prepared for:** Development Team
**Document type:** Functional & Technical Requirements
**Version:** 1.0

---

## 1. Purpose & Overview

Build a web-based CRM that integrates with the client's PABX (telephony) system so that when a call comes in or goes out, the system automatically pops up the caller's CRM record, showing their full **call history** and **chat history** (if the contact already exists in the CRM). The CRM should also include standard sales/customer-management features (contacts, leads, deals, tasks, reporting, etc.).

---

## 2. Scope

In scope:
- Core CRM (contacts, companies, leads, pipeline/deals, tasks, notes, calendar)
- PABX/CTI integration (screen pop, click-to-call, call logging, call recording links)
- Chat channel integration (WhatsApp/SMS/web chat) logged against the same contact
- Unified "360° customer view" combining calls + chats + notes + deals
- User roles, permissions, and audit trail
- Reporting/dashboards
- Notifications (in-app, email)

Out of scope (unless client confirms otherwise):
- Building a new PABX system (we integrate with the existing/chosen one)
- Marketing automation / email campaign engine (can be phase 2)
- Native mobile apps (phase 2 — start with responsive web app)

---

## 3. High-Level Architecture

- **Frontend:** Web app (responsive), with a persistent "call/chat popup" widget that can appear regardless of which CRM page the agent is on.
- **Backend:** REST/GraphQL API layer, business logic, auth, integration middleware.
- **Database:** Relational DB (e.g., PostgreSQL/MySQL) for structured CRM data.
- **PABX Integration Layer:** A middleware/service that listens to PABX events (via AMI/ARI, SIP trunk events, or vendor API/webhook) and pushes real-time events to the frontend (via WebSockets).
- **Chat Integration Layer:** Connectors/webhooks for WhatsApp Business API, SMS gateway, and/or web live-chat widget, normalizing all messages into one "conversation" data model tied to a contact.
- **File/Recording Storage:** Object storage (e.g., S3-compatible) for call recordings and chat attachments.

> **Developer note:** Please confirm which PABX/phone system the client uses (e.g., Asterisk, FreePBX, 3CX, Yeastar, Avaya, Grandstream UCM, or a cloud provider like Twilio/RingCentral) before implementation — the integration method (AMI/ARI, SIP events, or vendor REST API/webhooks) depends entirely on this.

---

## 4. PABX / CTI Integration Requirements

### 4.1 Screen Pop
- On an **inbound call**, the system must detect the caller's number in real time and display a popup (toast/modal) to the agent within **2 seconds** of ring start, showing:
  - Contact name & company (if matched by phone number)
  - Contact photo/avatar (if available)
  - Last 5 interactions (calls + chats + notes), most recent first
  - Quick action buttons: Answer, Open Full Profile, Create Note, Create Task, Log Disposition
- If the number is **not matched** to an existing contact, show an "Unknown caller" popup with an option to quickly create a new contact.
- Must also support **outbound** click-to-call from within a contact record (agent clicks a phone number → PABX initiates the call).

### 4.2 Call Logging & History
- Every call (inbound/outbound/missed) must be automatically logged against the matched contact record with:
  - Timestamp, direction, duration, agent/extension who handled it, disposition/outcome (dropdown: e.g., "Interested," "Follow-up," "No answer," "Not interested," custom types), and optional notes.
  - Link/embed to the call recording (if the PABX supports recording).
- Call history must be visible in one continuous timeline per contact, merged with chat history and notes (see Section 6).

### 4.3 Call Controls (optional but recommended)
- Basic in-app controls via CTI: Answer, Hang up, Hold, Transfer, Mute (support depends on PABX capability — confirm with client's PABX vendor docs).

### 4.4 Technical Integration Method
Depending on the confirmed PABX, one of the following:
- **Asterisk/FreePBX/Yeastar/3CX (on-prem):** Integrate via AMI (Asterisk Manager Interface) or ARI (Asterisk REST Interface) / vendor's Call Control API, listening for `Newchannel`, `Dial`, `Hangup` events, matching Caller ID to CRM contacts.
- **Cloud telephony (Twilio, RingCentral, etc.):** Use their provided webhooks/SDKs for call events and click-to-call.
- All events pushed to the frontend in real time via **WebSockets** (e.g., Socket.IO) so the popup appears without a page refresh.

---

## 5. Chat Integration Requirements

- Integrate at least one chat channel (confirm which: WhatsApp Business API, SMS, Facebook Messenger, or an embedded website live-chat widget).
- Incoming/outgoing messages should be matched to a contact by phone number/email, and logged in the same unified timeline as calls.
- Agents should be able to reply to chats directly from within the CRM (not just view history), if the client requires 2-way messaging.
- Store full chat transcripts with timestamps and attachments.

---

## 6. Unified 360° Contact View

Each contact record must show a single merged timeline containing:
- Calls (with recordings/dispositions)
- Chats (all connected channels)
- Notes added by agents
- Emails (if email integration is included)
- Tasks/reminders and deal/pipeline stage history

Timeline should be filterable by type (calls only, chats only, etc.) and searchable.

---

## 7. Standard CRM Features (Core Modules)

### 7.1 Contact & Company Management
- Create/edit/delete contacts and companies
- Custom fields (client-configurable)
- Contact ownership (assign to specific agents/teams)
- De-duplication check on phone number/email when creating new contacts
- Import/export (CSV)

### 7.2 Leads & Sales Pipeline
- Lead capture (manual entry, web form, or import)
- Configurable pipeline stages (e.g., New → Contacted → Qualified → Proposal → Won/Lost)
- Drag-and-drop or list-based deal/opportunity management
- Deal value, expected close date, probability, assigned owner

### 7.3 Tasks & Calendar
- Task creation with due dates, reminders, assignment to users
- Calendar view of tasks/meetings/follow-ups
- Automatic task suggestion after a call (e.g., "Schedule follow-up")

### 7.4 Notes & Activity Log
- Free-text notes attachable to any contact/deal
- Full audit/activity log per record (who changed what, and when)

### 7.5 User Management & Permissions
- Role-based access control (e.g., Admin, Manager, Agent)
- Managers can see all team activity; agents see only their assigned contacts (configurable)
- Login/authentication (email+password, with option for SSO later)

### 7.6 Reporting & Dashboards
- Call volume, average handle time, missed calls, agent performance
- Sales pipeline reports (conversion rates, deals won/lost, revenue forecast)
- Exportable reports (CSV/PDF)

### 7.7 Notifications
- In-app notifications for: incoming call, new chat message, task due, deal stage change
- Optional email notifications for key events

---

## 8. Non-Functional Requirements

| Category | Requirement |
|---|---|
| Performance | Screen pop must appear within 2 seconds of call ring |
| Scalability | Support at least [X] concurrent agents/extensions (confirm expected user count with client) |
| Availability | Target 99.5%+ uptime for production |
| Security | Encrypted data at rest and in transit (TLS); role-based access control |
| Compliance | Call recording must comply with local consent/privacy laws (confirm jurisdiction — e.g., Kenya's Data Protection Act) |
| Data backup | Daily automated backups of database and recordings |
| Browser support | Latest Chrome, Edge, Firefox, Safari |
| Responsiveness | Usable on desktop and tablet at minimum |

---

## 9. Data Model (Key Entities — for developer reference)

- **Contact:** id, name, phone(s), email, company_id, owner_id, custom_fields, created_at
- **Company:** id, name, industry, contacts[]
- **Call:** id, contact_id, direction, start_time, duration, agent_id, disposition, recording_url
- **Chat/Message:** id, contact_id, channel, direction, content, timestamp, attachments
- **Deal:** id, contact_id, stage, value, owner_id, expected_close_date
- **Task:** id, related_to (contact/deal), due_date, assigned_to, status
- **Note:** id, contact_id, author_id, content, timestamp
- **User:** id, name, role, extension_number (for PABX mapping), permissions

---

## 10. Open Questions for the Client (to resolve before/at project kickoff)

1. What PABX system/brand is currently in use (or planned)? On-premise or cloud-hosted?
2. Is call recording already enabled on the PABX? Legal consent process in place?
3. Which chat channel(s) need integration — WhatsApp, SMS, website live chat, or all?
4. Expected number of agents/extensions and expected call volume?
5. Do agents need in-app call control (answer/transfer/hold) or is screen-pop + logging enough?
6. Any existing systems to migrate contacts/history from?
7. Hosting preference — cloud (AWS/Azure/GCP) or on-premise server?
8. Do they need a mobile app now or is responsive web sufficient for phase 1?

---

## 11. Suggested Phasing

- **Phase 1:** Core CRM (contacts, deals, tasks) + PABX screen pop + call logging
- **Phase 2:** Chat channel integration + unified timeline
- **Phase 3:** Advanced reporting, mobile app, email integration, automation/workflows

---

*This document is intended as a starting brief. Final technical design (exact PABX integration method, hosting, and stack) should be confirmed once the client answers Section 10.*
