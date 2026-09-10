/**
 * Checks the marketing site the way a browser sees it: real layout, real media queries, real paint.
 *
 * It lives here rather than in apps/site because this is where Playwright already is, next to the
 * help figure capture. Serve apps/site/public on 8099 and run it:
 *
 *   node apps/web/scripts/check-site.mjs [--shots]
 *
 * Reports only pages with findings: horizontal overflow, a heading level skipped, more or fewer
 * than one h1, an image without alt or without dimensions, an image that failed to decode, and any
 * request that came back 400 or worse. --shots writes a desktop screenshot per page to shots/.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://127.0.0.1:8099';
const PAGES = [
  '/index.html',
  '/product.html',
  '/pricing.html',
  '/security.html',
  '/setup.html',
  '/contact.html',
  '/privacy.html',
  '/terms.html',
  '/data-deletion.html',
  '/404.html',
];

const shots = process.argv.includes('--shots');
const browser = await chromium.launch();

async function audit(width, height, label) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const rows = [];
  for (const path of PAGES) {
    const page = await context.newPage();
    const missing = [];
    page.on('response', (r) => {
      if (r.status() >= 400) missing.push(`${String(r.status())} ${r.url().replace(BASE, '')}`);
    });
    await page.goto(BASE + path, { waitUntil: 'networkidle' });
    // Runs inside the page: document and window are the browser's, reached through globalThis
    // because this file is linted as a Node script.
    const result = await page.evaluate(() => {
      const vw = globalThis.document.documentElement.clientWidth;
      const wide = [...globalThis.document.querySelectorAll('body *')]
        .filter((el) => !el.closest('.crop') && !el.classList.contains('plate'))
        .map((el) => ({
          sel:
            el.tagName +
            (typeof el.className === 'string' && el.className
              ? '.' + el.className.split(' ')[0]
              : ''),
          right: Math.round(el.getBoundingClientRect().right),
        }))
        .filter((x) => x.right > vw + 2)
        .slice(0, 3);
      const heads = [...globalThis.document.querySelectorAll('h1,h2,h3')].map((h) =>
        Number(h.tagName[1]),
      );
      let jump = null;
      let prev = 0;
      for (const level of heads) {
        if (prev && level > prev + 1 && jump === null) jump = `${String(prev)} to ${String(level)}`;
        prev = level;
      }
      return {
        overflow: globalThis.document.documentElement.scrollWidth - vw,
        wide,
        h1: heads.filter((x) => x === 1).length,
        jump,
        noAlt: [...globalThis.document.images].filter((i) => i.getAttribute('alt') === null).length,
        noDims: [...globalThis.document.images].filter((i) => !i.getAttribute('width')).length,
        broken: [...globalThis.document.images].filter((i) => i.complete && i.naturalWidth === 0)
          .length,
      };
    });
    if (shots && width > 1000) {
      const name = path.replace(/\W+/g, '-').replace(/^-|-html$/g, '');
      await page.screenshot({ path: `shots/${name}.png` });
      await page.evaluate(() =>
        globalThis.window.scrollTo(0, globalThis.document.body.scrollHeight * 0.28),
      );
      await page.waitForTimeout(400);
      await page.screenshot({ path: `shots/${name}-mid.png` });
    }
    rows.push({ path, ...result, missing: missing.slice(0, 3) });
    await page.close();
  }
  await context.close();
  const bad = rows.filter(
    (r) =>
      r.overflow !== 0 ||
      r.jump ||
      r.h1 !== 1 ||
      r.noAlt ||
      r.noDims ||
      r.broken ||
      r.missing.length,
  );
  console.log(`\n${label}: ${String(rows.length)} pages, ${String(bad.length)} with findings`);
  for (const r of bad) console.log(' ', JSON.stringify(r));
}

await audit(1440, 900, 'desktop');
await audit(380, 800, 'phone');
await browser.close();
