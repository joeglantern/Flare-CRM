/**
 * Captures the manual's screenshots from the running app (docs/22).
 *
 * Real screens with the demo data in them, in both themes, rather than drawings. Writes PNG, then
 * the same bytes as WebP and AVIF next to it, and a manifest of dimensions so the manual reserves
 * the right space and nothing jumps as the images load.
 *
 *   pnpm --filter @crm/api dev:seed-demo         # data to photograph
 *   pnpm dev & pnpm dev:worker & pnpm dev:web    # the app itself
 *   pnpm --filter @crm/web help:figures
 *
 * Environment: HELP_BASE_URL (default http://127.0.0.1:5173), HELP_EMAIL, HELP_PASSWORD.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { chromium } from 'playwright';
import { FIGURES, settle } from './help-figures.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../public/help');
const manifestPath = resolve(here, '../src/features/help/content/figures.json');

const BASE = process.env.HELP_BASE_URL ?? 'http://127.0.0.1:5173';
const EMAIL = process.env.HELP_EMAIL ?? 'admin@example.com';
const PASSWORD = process.env.HELP_PASSWORD ?? '';
const THEME_KEY = 'flare.theme';
const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
};
const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));

if (PASSWORD === '') {
  console.error('Set HELP_PASSWORD (and HELP_EMAIL) to an admin of the running dev stack.');
  process.exit(1);
}

async function signIn(context) {
  const page = await context.newPage();
  await page.goto(`${BASE}/sign-in`);
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/sign-in'), { timeout: 20_000 });
  await page.close();
}

async function applyMocks(page, mock) {
  for (const [pattern, value] of Object.entries(mock)) {
    await page.route(pattern, async (route) => {
      const status =
        typeof value === 'object' && value !== null && 'status' in value ? value.status : 200;
      const body =
        typeof value === 'object' && value !== null && 'body' in value ? value.body : value;
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    });
  }
}

async function capture(context, figure, theme) {
  const viewport = VIEWPORTS[figure.viewport ?? 'desktop'];
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  // Runs inside the page, before any of the app does, so the theme is set on first paint.
  await page.addInitScript(
    ([key, value]) => {
      globalThis.localStorage.setItem(key, value);
    },
    [THEME_KEY, theme],
  );
  if (figure.mock) await applyMocks(page, figure.mock);

  await page.goto(`${BASE}${figure.route}`);
  await settle(page);

  if (figure.follow === 'first-row') {
    const row = page.locator('[role="row"]').nth(1);
    if (await row.count()) {
      await row.click();
      await settle(page);
    }
  }
  if (figure.actions) await figure.actions(page);
  await page.waitForTimeout(300);

  const target = figure.selector ? page.locator(figure.selector).first() : page;
  const png = await target.screenshot({ type: 'png' });
  await page.close();
  return png;
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ deviceScaleFactor: 2 });
  await signIn(context);

  const manifest = {};
  const wanted = only.length > 0 ? FIGURES.filter((f) => only.includes(f.name)) : FIGURES;
  let done = 0;

  for (const figure of wanted) {
    const dir = resolve(out, figure.chapter);
    await mkdir(dir, { recursive: true });
    try {
      for (const theme of ['light', 'dark']) {
        const png = await capture(context, figure, theme);
        const base = resolve(dir, `${figure.name}-${theme}`);
        const meta = await sharp(png).metadata();
        await Promise.all([
          writeFile(`${base}.png`, png),
          sharp(png).webp({ quality: 85, effort: 6 }).toFile(`${base}.webp`),
          sharp(png).avif({ quality: 80, effort: 6 }).toFile(`${base}.avif`),
        ]);
        // The manifest holds CSS pixels, not the 2x device pixels the file is stored at.
        manifest[`${figure.chapter}/${figure.name}`] = {
          width: Math.round((meta.width ?? 0) / 2),
          height: Math.round((meta.height ?? 0) / 2),
        };
      }
      done++;
      console.log(
        `${String(done).padStart(3)}/${String(wanted.length)}  ${figure.chapter}/${figure.name}`,
      );
    } catch (err) {
      // One screen that will not cooperate must not cost every other figure.
      console.error(`  skipped ${figure.chapter}/${figure.name}: ${err.message}`);
    }
  }

  await browser.close();

  // Merge rather than replace, so capturing a single figure does not drop the rest.
  let existing = {};
  try {
    const { default: current } = await import(`file://${manifestPath}`, { with: { type: 'json' } });
    existing = current;
  } catch {
    // no manifest yet
  }
  const merged = Object.fromEntries(
    Object.entries({ ...existing, ...manifest }).sort(([a], [b]) => a.localeCompare(b)),
  );
  await writeFile(manifestPath, `${JSON.stringify(merged, null, 2)}\n`);
  console.log(`\n${String(Object.keys(merged).length)} figures in the manifest`);
}

await main();
