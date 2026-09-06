# 18. Flare CRM: brand, visual direction and design brief

This file is the single source of truth for the visual identity and for the frontend design work. It is written so that it can be handed to a designer as-is. No em dashes are used anywhere in this document on purpose.

## 1. Product in one paragraph

Flare CRM is a sales and customer-service CRM for small and mid-size teams that live on the phone. It is wired into a Yeastar P-Series PBX: when a customer calls, the agent's screen pops with the contact, their history and the open deals before they pick up. Every call, WhatsApp message, note, task and deal change lands on one contact timeline. Managers see live calls, agent performance and pipeline forecasts. The product runs on the client's own Linux VPS. The first market is Kenya, so phone numbers, currency (KES) and time zone (Africa/Nairobi) are first-class.

## 2. Positioning and personality

- Feels like a serious operations tool, not a marketing site. Dense, quick, keyboard friendly.
- Warm, not cold. The "flare" is a small point of heat and light: focus, urgency, a call coming in.
- Confident and quiet. One accent colour used sparingly. No purple to blue gradients, no glowing orbs, no glassmorphism blobs, no "futuristic" chrome. Those read as generic template work.
- References that get the tone right: Linear (density, dark mode discipline), Attio and Twenty CRM (records, tables, relationships), Front and Intercom inbox (conversation UI), Aircall and Dialpad agent desktops (call popups, in-call controls), Stripe dashboard (reports and tables), Vercel dashboard (true black done well), Raycast and Arc (glossy, semi-3D icons that still feel crafted).

## 3. Colour system

True black dark theme, paper-white light theme, one warm accent. Every colour has a semantic role. Use only these tokens.

### Accent: Flare

| Token     | Hex     | Use                                                                       |
| --------- | ------- | ------------------------------------------------------------------------- |
| flare-300 | #FFB08A | accent on dark backgrounds where more contrast is needed (links on black) |
| flare-400 | #FF8A5B | hover state of primary actions on dark                                    |
| flare-500 | #FF6A3D | primary accent. Buttons, active nav, ringing state, focus rings           |
| flare-600 | #E4532A | primary hover on light theme, pressed state on dark                       |
| flare-700 | #B83F1E | primary pressed on light theme, text-on-flare-100                         |
| flare-100 | #FFE9DF | subtle accent surfaces on light theme (selected row, badge background)    |
| flare-950 | #2A120A | subtle accent surfaces on dark theme (selected row, badge background)     |

The accent is slightly desaturated orange with a red lean. It is deliberately not the neon "#FF5500" that image generators default to.

### Neutrals (warm greys, near-black tinted towards the accent so black and orange feel related)

Dark theme (true black)

| Token         | Hex     | Use                                          |
| ------------- | ------- | -------------------------------------------- |
| bg            | #000000 | app background                               |
| bg-raised     | #0B0B0C | sidebar, panels                              |
| surface       | #121213 | cards, table rows, inputs                    |
| surface-hover | #1A1A1C | row hover, menu hover                        |
| border        | #232325 | hairlines. 1px, never thicker                |
| border-strong | #2F2F32 | input borders, focused table cell            |
| text          | #F2F1EF | primary text (slightly warm, not pure white) |
| text-muted    | #A3A19C | secondary text, timestamps                   |
| text-faint    | #6B6965 | placeholders, disabled                       |

Light theme

| Token         | Hex     | Use                                    |
| ------------- | ------- | -------------------------------------- |
| bg            | #FAFAF8 | app background (paper, not blue-white) |
| bg-raised     | #FFFFFF | sidebar, panels                        |
| surface       | #FFFFFF | cards, rows, inputs                    |
| surface-hover | #F3F2EF | hover                                  |
| border        | #E6E4DF | hairlines                              |
| border-strong | #CFCCC5 | inputs                                 |
| text          | #17171A | primary text                           |
| text-muted    | #5F5E5A | secondary                              |
| text-faint    | #9A9893 | placeholders                           |

### Status colours (same in both themes, adjust lightness by ±1 step if contrast fails)

| Role    | Dark      | Light     | Meaning                                                        |
| ------- | --------- | --------- | -------------------------------------------------------------- |
| success | #3DD68C   | #1E9E5E   | won deal, delivered, connected PBX                             |
| warning | #F5B940   | #B7791F   | pending, on hold, 24h window closing                           |
| danger  | #F0564D   | #C8322B   | missed call, failed message, destructive actions               |
| info    | #5CA8FF   | #2F6FD6   | informational only. Use rarely so blue never becomes the brand |
| ringing | flare-500 | flare-600 | incoming call, pulsing                                         |
| talking | success   | success   | live call in progress                                          |

### Rules

- Contrast: text on surfaces must pass WCAG AA (4.5:1). flare-500 on #000000 passes for large text and icons; use flare-300 for small text links on black.
- Accent budget: at most one primary button visible per view. Everything else is neutral.
- No gradients in the UI. Gradients live only in brand assets (logo, hero art), and there they are a two-stop flare-400 to flare-700 with a soft highlight, never rainbow.
- Charts: series colours in order flare-500, #8A8985 (neutral), #3DD68C, #F5B940, #5CA8FF. Never more than five series.

## 4. Typography

- UI: Inter (variable). Alternative if a bit more character is wanted: Geist or Instrument Sans. Tight tracking on headings (-0.01em to -0.02em), tabular numbers everywhere numbers align (`font-variant-numeric: tabular-nums`).
- Numbers and identifiers (phone numbers, extensions, call ids, durations): Geist Mono or JetBrains Mono at 90 percent size.
- Scale: 11, 12, 13 (default body in tables), 14 (default body), 16, 20, 24, 32. Line height 1.4 for body, 1.2 for headings.
- Weights: 400, 500 (labels, nav), 600 (headings). Never 700+ in product UI.

## 5. Shape, spacing, depth

- Spacing base 4px. Component padding 8/12/16. Page gutters 24 on desktop, 16 on tablet, 12 on mobile.
- Radius: 6 for inputs and buttons, 8 for cards, 10 for dialogs, full for pills and avatars.
- Depth in dark theme comes from surface steps, not shadows. In light theme a single soft shadow `0 1px 2px rgba(0,0,0,.06), 0 4px 12px rgba(0,0,0,.06)` on floating elements only.
- Borders are 1px hairlines. No 2px borders except the focus ring (2px flare-500 outside, 2px offset).
- Motion: 120ms for hover, 180ms for open/close, 240ms for panel slide. Ease out. The only looping animation is the ringing pulse on the call popup and the "live" dot on active calls.

## 6. Iconography and imagery

- Product icons: Lucide, 16px in tables and nav, 20px in headers, stroke 1.75. No filled icon sets.
- Brand and empty-state art: semi-3D glossy objects in the brand palette (see prompts in section 9). Used only in empty states, onboarding, login side panel and the marketing site. Never inside data tables.
- Photos: none in the product.

## 7. Logo concept

The mark is a "flare": a rounded, slightly asymmetric teardrop or spark whose tip points up-right, with a small inner highlight, like a match head or a signal flare seen from the side. It must work at 16px as a favicon, so it is one solid shape, no thin strokes. The wordmark is "Flare" in a heavy geometric sans with the "CRM" set small and letterspaced next to it in text-muted. Monochrome versions are required (all black, all white, all flare-500).

## 8. Assets checklist

1. Brand sheet: logo mark, wordmark, lockup, app icon in a squircle, monochrome versions, on black and on white.
2. App icons: 1024 squircle master, plus flat favicon version.
3. Empty-state objects (semi-3D, glossy, transparent PNG): phone handset, headset, chat bubble, inbox tray, envelope, calendar, bell, folder with cards, bar chart, funnel, contact card, shield, key, magnifier, upload arrow, spreadsheet, link chain, plug or cable (PBX disconnected), clock, checkmark badge, warning triangle.
4. Abstract brand graphics (large PNG, transparent where possible): flare light streaks, soft ember gradients, ring and arc shapes, halftone fades, grain overlays.
5. Background textures (tileable): fine film grain for dark, subtle paper for light, brushed dark metal, carbon weave, soft vignette.
6. Login and onboarding hero composition (dark and light variant).
7. Abstract avatar placeholders (no faces): 12 to 16 variants in the palette.
8. Social and store: OG image 1200x630, app store style feature graphic 1024x500.

## 8b. Assets on disk

Brand assets already exist in the repository at assets/brand/source (see assets/brand/README.md for the inventory): the brand sheet with the final mark, wordmark and colour chips (01-brand-sheet.png), two grids of semi-3D empty-state objects (03 and 04), abstract graphics (05), tileable textures (06), the login hero in dark and light (07), abstract avatar placeholders (08) and the open-graph image (09). Use the mark and wordmark from the brand sheet as the logo everywhere, use the hero in the sign-in layout, use the objects only in empty states and onboarding, and use the avatar placeholders wherever a user or contact has no photo.

## 9. Page and UI checklist (nothing may be missing)

Authentication and account

- Sign in (email, password, remember me, show password, error states, rate-limited state, banned or deactivated account message)
- Two-factor verification (TOTP code, backup code entry, trusted device option)
- Two-factor enrolment (QR code, manual key, confirm code, backup codes download, required-for-role interstitial that blocks admins and managers until enrolled)
- Forgot password, check-your-email state, reset password (strength meter, breached-password error from Have I Been Pwned), set password from welcome link (first login), link expired state
- Sign out everywhere confirmation
- Profile: name, phone, time zone, locale, avatar upload and removal, change password, two-factor management, active sessions list with revoke
- Notification preferences (per type, in-app and email)

App shell

- Sidebar navigation (collapsed and expanded), role-based items, PBX status dot, WhatsApp channel status dot
- Top bar: global search with grouped results and keyboard navigation, notification bell and dropdown, presence and extension chip, theme toggle, user menu
- Notification centre page (list, mark read, mark all read, filter by type, deep links)
- Command palette (Ctrl+K)
- Global toasts, confirm dialogs, destructive-action dialogs with typed confirmation for erase and delete
- Offline banner, session expired dialog, PBX disconnected banner (agents), WhatsApp disconnected banner (agents), maintenance and 5xx error page, 404, 403 (permission denied), skeleton loaders for every list and detail

Dashboard (home)

- Agent home: my tasks due today and overdue, my missed calls, my open conversations, my open deals, today's call stats, quick actions
- Manager and admin home: live calls board (ringing, talking, since, agent), team call summary today, missed calls needing callback, pipeline snapshot, top agents, unassigned conversations, PBX status card

Contacts

- Contacts list (table: name, company, phones, owner, tags, last activity, created; filters: owner, team, tag, source, do-not-call, has open deal; saved views; column chooser; bulk select with bulk assign owner, add tag, delete; export CSV)
- Contact create and edit (first and last name, multiple phones with type and primary, multiple emails, company picker with inline create, owner, source, tags, do-not-call, custom fields by type: text, number, date, select, multi-select, boolean, url, email, phone)
- Contact 360 detail: header with avatar, primary phone with click-to-dial and WhatsApp buttons, do-not-call badge, owner, company, tags; tabs or panels for Timeline (all activity types with filters and search), Deals, Tasks, Notes, Calls (with recordings), Conversations, Files; custom fields panel; related company card
- Contact avatar upload and removal
- Duplicates review (grouped by phone and email, side-by-side compare, merge with field-level winner selection)
- Merge confirmation and result
- Soft delete, restore, and permanent erase (GDPR style typed confirmation, admin only)
- Import contacts wizard (upload CSV, preview, column mapping to fields including custom fields, duplicate strategy, run, progress, result with per-row error report download)

Companies

- Companies list (name, domain, phone, industry, owner, contacts count, open deals value), filters, bulk actions, export
- Company create and edit (name, domain, phones, address, industry, size, owner, custom fields)
- Company detail: header, contacts list, deals, timeline, notes, custom fields

Leads

- Leads list (name, phone, company, source, status, owner, created, last activity), filters by status, source, owner, web form; bulk assign and status change; export
- Lead create and edit
- Lead detail with timeline, tasks and notes
- Convert lead dialog (create or match contact, create or match company, optional deal with pipeline, stage, value, expected close)
- Web form submissions view for leads created from public forms

Deals and pipeline

- Kanban board per pipeline (columns are stages with totals and counts, drag between stages, won and lost columns, quick filters by owner and team, card shows name, contact, company, value KES, age in stage, next task, owner avatar)
- Deals list view with the same filters
- Deal create and edit (name, pipeline, stage, value, currency, expected close, contact, company, owner, custom fields)
- Deal detail: header with stage stepper, value and probability, won and lost actions with reason, stage history, timeline, tasks, notes, files
- Bulk actions (assign owner, change stage, delete)
- Pipeline and stage admin (create pipeline, add and reorder stages, stage type open, won, lost, probability, delete with reassignment)

Tasks

- Task list (title, type: call, follow-up, meeting, email, other; status; priority; due; assignee; linked contact or deal), filters (mine, team, overdue, today, this week), bulk complete and reassign
- Calendar view (month, week, day) with drag to reschedule
- Task create and edit (title, type, due date and time, priority, assignee, reminder, link to contact or deal or company, description)
- Task detail and quick complete
- Reminder notification and after-call "suggest follow-up" prompt

Notes

- Inline notes on contact, company, deal and call with edit, delete, author and time
- Note composer with mentions of contacts and deals (plain text with linkified entities)

Calls and telephony

- Incoming call popup (all states: ringing, answered by me, answered elsewhere, missed, cancelled, unknown number with create contact)
- In-call panel (timer, hold, unhold, mute, unmute, transfer with extension picker, hang up, add note during call, open contact)
- Outbound click-to-dial from any phone number (dial confirmation, dialing state, do-not-call block message, PBX unavailable message)
- Calls list (direction, status, number and contact, agent and extension, started, duration, disposition, recording icon), filters (mine, team, direction, status, date range, disposition, has recording), export CSV
- Call detail (metadata, contact link and link-contact action for unknown numbers, disposition and notes editor, recording player with waveform or progress bar, download for permitted roles, delete recording for admins, audit trail of who played it)
- Missed calls view with callback action and "handled" marking
- Live calls board for managers (realtime)
- Call dispositions admin (create, rename, order, deactivate)

Inbox (WhatsApp and future channels)

- Conversation list (filters: mine, unassigned, team, status open, closed, archived, channel; unread badge; last message preview; contact name or number; assignee avatar; reply window indicator)
- Conversation view (message bubbles with status ticks queued, sent, delivered, read, failed with error; inbound media preview and download; timestamps; day separators; typing composer with attachment upload, emoji, template picker; 24 hour window closed banner with template-only composer; assign, close, reopen, archive actions; contact side panel with link-to-contact for unknown numbers, create contact, recent timeline)
- Start conversation dialog from a contact (choose channel and phone)
- Template picker (name, language, parameters preview)
- Channel admin (list channels, create and edit WhatsApp channel with phone number id, secrets entry that is never displayed back, active toggle, webhook URL and verify token instructions)

Reports

- Calls summary (date range, team and agent filters; totals, answered, missed, average duration, talk time; charts)
- Agent performance table (calls, answered, missed, talk time, average handle time, dispositions breakdown)
- Missed calls report
- Pipeline summary (value by stage, count by stage, won and lost this period)
- Conversion report (stage to stage conversion, lead to deal conversion)
- Forecast (expected value by close month, weighted by probability)
- Every report has export CSV and a printable layout

Import and export

- Imports list (entity, status, rows, errors, started by, download error report)
- Export dialogs for contacts, companies, leads, deals, calls (filters carry over)

Web forms

- Web forms list, create and edit (name, fields with types and required flags, allowed origins, default owner, success message), embed snippet and endpoint URL with token, regenerate token, test submission, submissions count

Settings (admin)

- General (default country, currency, agent visibility owned, team or all)
- Users (list with role, extension, team, status, last seen; create user which sends the welcome email; edit; change role with confirmation that sessions are revoked; deactivate and reactivate; revoke sessions; resend welcome)
- Teams (create, rename, members, manager)
- Telephony (PBX status with connected since and last event, capabilities returned by the PBX, reconnect and reconcile actions, extension to user mapping view, dial rules such as prefix and country handling, popup options: pop on internal calls, auto-open profile on answer, suggest follow-up after call)
- Recording (consent text, retention days, allow agent playback)
- Retention (soft delete purge days, PBX events days, raw message payload days) with an explanation of what each purge does
- Matching (allow suffix match for phone lookups)
- Security (two-factor required for privileged roles, session idle minutes, password policy display)
- Custom fields (per entity: contact, company, deal, lead; create, edit, reorder, deactivate; option lists for selects)
- Call dispositions
- Pipelines and stages
- Channels
- Web forms
- Audit log (filters by entity, entity id, actor, action, date; diff view of before and after; export)
- System status page (API, database, Valkey, storage, PBX, WhatsApp, queues with waiting and failed counts, last backup status from last-status.json)
- Public settings consumed by the SPA before login: theme, country, currency, product name and logo

Cross-cutting

- Role matrices applied to every screen (admin, manager, agent) including team scoping for managers and owned scoping for agents
- Keyboard shortcuts sheet
- Accessibility: focus order, visible focus rings, ARIA for live regions (ringing call, new message), reduced motion mode
- Realtime behaviours listed per screen: which socket events update which components (call:ringing, call:answered, call:ended, call:logged, call:updated, live-calls:snapshot, agent:presence, pbx:status, message:new, message:status, conversation:updated, notification:new, entity updates)
- Print styles for reports and contact detail
- Mobile layouts for inbox, tasks, contact detail and the call popup
