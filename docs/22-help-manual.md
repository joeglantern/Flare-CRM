# 22. The in-app manual

The whole manual lives inside the product, at `/help`. Twenty-five chapters, real screenshots of
this build, drawn diagrams, search, and a printable version. It adapts to the customer's plan and
the reader's role: a chapter about something they do not have is not there to confuse them.

## 1. Why it is typed content, not markdown

Content is TypeScript in `apps/web/src/features/help/content/`, the same house pattern as
navigation and settings sections. That buys three things markdown would not:

- A chapter can be gated by a feature key or a permission, checked against the same catalogue the
  server enforces (docs/20). A wrong key fails typecheck.
- Search, printing and the tests all read the same blocks through one reducer, `blockText()`, so
  they cannot drift apart.
- No HTML is ever injected. Inline text supports `<kbd>` and `<em>` and nothing else, through a
  tokenizer rather than `innerHTML`.

## 2. The pieces

| Path                                    | What it holds                                                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `content/types.ts`                      | `Chapter`, `Section`, and the `Block` union: paragraph, steps, callout, figure, table, diagram, shortcuts, related, permissions |
| `content/chapters/*.ts`                 | The chapters themselves, grouped: getting started, records, calls, messaging and reports, administration, reference             |
| `content/index.ts`                      | `CHAPTERS`, and `visibleChapters(access)` which filters by plan and role                                                        |
| `content/blocks.ts`                     | `blockText()`, the one reduction search, print and tests share                                                                  |
| `content/inline.ts`                     | The `<kbd>`/`<em>` tokenizer                                                                                                    |
| `content/figures.json`                  | Every captured figure with its dimensions, so a page never reflows as images load                                               |
| `diagrams/index.tsx`                    | Inline SVG drawn on CSS variables, so they follow the theme                                                                     |
| `search.ts`                             | Client-side index: title 10, heading 5, body 1                                                                                  |
| `context.ts`                            | `chapterForPath()`, longest prefix, behind the help icon in the top bar                                                         |
| `HelpScreen.tsx`, `HelpPrintScreen.tsx` | `/help` and `/help/print`                                                                                                       |

## 3. Chapters

Getting started, home, contacts, companies, leads, deals, tasks, notes and files, calls,
recordings, live calls, inbox, reports, import and export, notifications, web forms, settings,
users and roles, security, backups and retention, the audit log, your plan, search and shortcuts,
troubleshooting, glossary.

Chapters for features that can be switched off carry the feature key, so with telephony off the
calls, recordings and live calls chapters are absent from the navigation, from search and from the
printed manual. A direct link to a hidden chapter shows the locked state, naming the feature and
who to contact, rather than a dead end.

## 4. Figures

Captured, never hand-drawn, so they always show this build:

```
pnpm --filter @crm/api dev:seed-demo
pnpm --filter @crm/web help:figures
```

`scripts/capture-help-figures.mjs` drives a real browser over the seeded dev stack, waits for
`[data-page-ready]`, and writes each figure as AVIF and WebP at 2× in both themes plus a PNG
fallback at 1×. The manifest it writes (`content/figures.json`) is what the `Figure` component
reads for dimensions. A figure a chapter references but the manifest does not have renders as
nothing and fails the test suite, so the manual can never point at a picture that does not exist.

Synthetic states (offline, PBX down, an expired plan) are produced by intercepting the request in
the capture script. That is the one acceptable use of a mock here, because the output is a
photograph of the real component in a state that is hard to arrange on demand.

## 5. Printing

`/help/print` renders the cover, the table of contents and every visible chapter into one
document, with the print CSS in `app.css`: page margins, a page break before each chapter, forced
light theme and light figures, and the toolbar hidden. It is the whole manual for a customer who
wants one on paper, and it respects the same plan and role filtering.

## 6. Getting to it

- `/help` in the navigation.
- The help icon in the top bar opens the chapter for the screen the reader is on.
- The command palette: `Ctrl K`, then `help <anything>`.
- `G` then `L`.

## 7. Tests

`help.test.ts` checks what a person cannot: every figure exists on disk in both themes, every
`related` id resolves, every feature and permission key is real, chapter ids are unique,
`chapterForPath` covers every route under `routes/_app`, every diagram name exists, no block
reduces to empty text, search ranks the obvious query first, and gating removes what it should.
