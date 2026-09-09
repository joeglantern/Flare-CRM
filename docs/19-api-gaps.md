# API gaps the frontend works around

Every place where the designed screen wanted something the API does not offer. Each gap is
referenced by number in the code, next to the workaround, so a future change to the API can be
traced straight to the screens that would benefit.

GAP-01 to GAP-12 came out of the design review. GAP-13 onwards were found while building
against the real endpoints.

The rule throughout: never invent a field, never fake a capability. Where the API cannot answer a
question, the screen either derives the answer from data it already has and says so, or says
plainly that the answer is not available.

## Pagination and lists

| Gap    | What the design assumed        | What the API does                   | How the frontend handles it                                                                                                                                      |
| ------ | ------------------------------ | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GAP-01 | Cursor pagination on contacts  | `GET /contacts` is offset paginated | The contacts table uses the offset pager. Cursor mode exists in `DataTable` for the endpoints that do use it (conversations, messages, notifications, activity). |
| GAP-11 | Saved views stored server side | No saved-view endpoint              | `SavedViews` keeps them in `localStorage`. They are per browser and the UI does not imply they are shared.                                                       |

## Contacts and companies

| Gap    | What the design assumed         | What the API does                                                                    | How the frontend handles it                                                                                                               |
| ------ | ------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| GAP-02 | Merge picks a winner per field  | `POST /contacts/:id/merge` takes `sourceId` only; the target always wins on conflict | The merge dialog shows exactly which values will be lost before it runs, rather than offering a field picker the API would ignore.        |
| GAP-06 | Company has `domain` and `size` | The DTO has `website` (a full URL) and `industry`                                    | The list shows the hostname parsed from the website. Company size lives as a custom field, so it renders through the custom fields block. |

## Tasks

| Gap | What the design assumed | What the API does | How the frontend handles it |
| --- | ----------------------- | ----------------- | --------------------------- |

## Inbox

| Gap    | What the design assumed       | What the API does                                                        | How the frontend handles it                                                                                                                                                                     |
| ------ | ----------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GAP-04 | A team scope on conversations | `GET /conversations` takes `mine`, `unassigned` or a single `assigneeId` | Anyone with `chat:assign` gets a per-person assignee filter. A client-side team filter was rejected: the list is cursor paginated, so filtering a page in the browser would silently drop rows. |

## Calls

| Gap    | What the design assumed                 | What the API does                 | How the frontend handles it                                                                 |
| ------ | --------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------- |
| GAP-15 | "Agents on shift" from PBX registration | Registration state is not exposed | The team board reports how many users have an extension set, and labels it as exactly that. |

## Reports

| Gap    | What the design assumed      | What the API does                                                                                    | How the frontend handles it                                                                                     |
| ------ | ---------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| GAP-10 | A date range on the forecast | `GET /reports/pipeline/forecast` takes `months`                                                      | The shared range picker is disabled on that tab and explains why, rather than accepting a range it would drop.  |
| GAP-18 | A scope switch on reports    | Scope is derived from the caller's role; `userId` and `teamId` narrow within it, they never widen it | The header states whose numbers are on screen. No scope switch is offered.                                      |
| GAP-19 | A report export endpoint     | No such endpoint                                                                                     | Export runs the CSV export of the underlying entity, and the dialog says it exports rows rather than the chart. |

## Search

| Gap    | What the design assumed       | What the API does         | How the frontend handles it                                                                                                                                                                                                         |
| ------ | ----------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GAP-13 | `GET /search` across entities | No global search endpoint | The command palette fans out to `/contacts`, `/companies`, `/deals` and `/leads` with `q=` in parallel and groups the results. A `safeList` wrapper means a 403 on one entity narrows the results rather than blanking the palette. |

## Import and export

| Gap    | What the design assumed | What the API does                                                                        | How the frontend handles it                                                                                              |
| ------ | ----------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| GAP-09 | Every entity importable | `IMPORT_FIELDS` covers contact, company and lead; deals, tasks and calls are export only | The wizard offers only the three importable entities and states the limit, so nobody builds a CSV that cannot be loaded. |

## Fixed during the build, not worked around

These were mismatches in the frontend's own assumptions, corrected against the real contract rather
than papered over:

- The board endpoint returns `{ pipelineId, columns }`, and a stage carries `type`, not `stageType`.
- Lead conversion returns the updated lead alongside the three new ids.
- `POST /imports` needs the entity as a multipart field, not only the file and the mapping.
- A user's role changes through `POST /users/:id/role`, not `PATCH /users/:id`, because changing it
  revokes that user's other sessions. Activation uses `/deactivate` and `/reactivate`.
- Company import is gated by `contact:import`; there is no `company:import` permission.
- A finished answered call has status `completed`. `answered` means the call is still up, which is
  why the demo seed was writing rows the call reports did not count.

## Closed since the design review

Built for real once the workaround stopped being good enough. Kept here, rather than deleted, so
the number in old commits and audit entries still resolves to something.

- **GAP-05** — a channel's WhatsApp reply templates can now be recorded from Settings, Channels,
  in `config.templates`, rather than never at all. Meta still owns approval and still exposes no
  list to pull from.
- **GAP-07** — the company DTO now carries `openDealCount` and `openDealValue`, computed with one
  grouped query per page server side, instead of one `GET /deals?companyId` per visible row from
  the browser.
- **GAP-08** — `GET /calls` takes a `companyId` filter directly.
- **GAP-14** — a contact's Files tab now also lists attachments on notes written about them, now
  that a note can carry one. There is still no dedicated file store; this is what actually carries
  a file for a contact today.
- **GAP-16** — the calls summary returns `byHour` and `byDisposition`, so both charts draw.
- **GAP-17** — `GET /reports/calls/missed` returns `attempts` and `returned` on each row, computed
  across the whole window server side, rather than derived in the browser from whatever page of
  outbound calls happened to be loaded.
- **GAP-03** — `POST /tasks/bulk` runs each task's own update inside one request instead of one
  round trip per row from the browser. It still applies each task's update individually rather
  than a single SQL statement, because completing or reassigning one also reschedules its
  reminder, records activity and notifies its assignee, none of which a bulk update could do.
- **GAP-12** — `GET /calls/:id/recording-history` lists who has played a recording, most recent
  first, gated on the same permission as listening rather than the audit log's `audit:read`. Call
  detail shows it inline instead of linking to the audit log.
