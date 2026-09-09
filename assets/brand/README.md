# Flare CRM brand assets

`source/` holds the master artwork at full resolution. Nothing in here ships to the browser as-is: the frontend gets sliced and optimised derivatives in `apps/web/public/brand/` and `apps/web/src/assets/` once the frontend exists. Keep the originals; never overwrite them.

## The mark

A four-point curved spark, satin warm red-orange (#FF6A3D core, #B83F1E shadow), tip pointing up-right. The wordmark is "Flare" in a heavy geometric sans with "CRM" small and letterspaced in grey. Everything below uses that mark. The final logo must be vector (SVG); the PNGs here are the reference to draw it from.

## Inventory (`source/`)

| File                                 | What it is                                                                                                                                                                                                            | Prompt |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 01-brand-sheet.png                   | Mark, app icon, monochrome versions, wordmark, lockups, colour chips. The master reference.                                                                                                                           | A      |
| 03-empty-state-objects-batch-1.png   | 4 x 5 grid: handset, headset, chat bubble, inbox tray, envelope, calendar, bell, folder, bar chart, funnel, contact card, shield, key, magnifier, upload, spreadsheet, chain links, unplugged cable, clock, checkmark | C      |
| 04-empty-state-objects-batch-2.png   | 4 x 5 grid: warning triangle, paper plane, rotary dial, sim card, sound wave, cassette, stopwatch, kanban, pipeline, map pin, tag, KES coins, handshake, trophy, hourglass, lock, filter, table, pencil, sparkline    | D      |
| 05-abstract-graphics-v1.png / v2.png | 3 x 3 grid: light streak, ring, arc, soft blob, halftone fade, spheres, ribbon, stacked slabs, hairline grid                                                                                                          | E      |
| 06-textures-v1.png / v2.png / v3.png | 2 x 3 grid: film grain, warm paper, brushed metal, carbon weave, vignette, dot grid                                                                                                                                   | F      |
| 07-login-hero-v1.png / v2.png        | Dark and light product-photo style hero of the mark                                                                                                                                                                   | G      |
| 08-avatar-placeholders.png           | 4 x 4 grid of abstract circular avatars, transparent                                                                                                                                                                  | H      |
| 09-og-image-v1.png / v2.png          | Open-graph image, lockup plus cropped mark                                                                                                                                                                            | I      |

There is no separate app icon master. The icon is drawn as vector from the mark on the brand sheet, which is the better source anyway.

## Derived files

Produced by `apps/web/scripts/build-brand-assets.mjs` (`pnpm --filter @crm/web brand`) into `apps/web/public/`. Everything there is generated; edit the source or the script, never the output.

- `brand/mark.svg`, `mark-mono-white.svg`, `mark-mono-black.svg`, `app-icon.svg` (hand-drawn vector, the script rasterises from these)
- `favicon.svg`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `maskable-512.png`
- `brand/og.png` (1200 x 630)
- `brand/objects/<name>.{avif,webp,png}` (40 objects, transparent, 256 px)
- `brand/avatars/abstract-01` to `abstract-16` `.{avif,webp,png}` (128 px)
- `brand/hero-dark` and `brand/hero-light` `.{avif,webp,png}`

Anything the app displays ships in all three formats and is referenced through `<picture>`, so the browser takes AVIF, falls back to WebP, then PNG. The icons and the open-graph card are PNG only because manifests and link-preview crawlers do not negotiate formats. Textures are not derived: nothing in the app uses them yet.

## Usage rules (from docs/18)

Semi-3D objects appear only in empty states, onboarding, the login side panel and marketing. Never inside data tables or next to form fields. Textures are used at low opacity (film grain on the dark theme background, paper on the light theme) and must not reduce text contrast.
