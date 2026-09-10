/**
 * Derives every brand asset the app ships from the master generations in assets/brand/source.
 *
 *  - slices the 4x5 object grids (03, 04) into 40 transparent PNGs
 *  - slices the 4x4 avatar grid (08) into 16 round placeholders
 *  - splits the login hero (07) into its dark and light halves
 *  - crops the mark, mono marks, wordmark and app icon out of the brand sheet (01)
 *  - rasterises the vector icons the browser and the manifest need
 *
 * The master grids already carry a real alpha channel, so nothing is keyed or matted. Each tile is
 * only cleaned of neighbour bleed by scripts/lib/object-tile.mjs, then trimmed and padded.
 *
 * Everything the app itself displays (objects, avatars, hero) is written three times: AVIF and
 * WebP for the browser to pick through <picture>, and PNG as the fallback and the canonical file.
 * A 256px illustration is ~80 KB as PNG and under 10 KB as either modern format, and there are
 * forty of them, so this is the difference between empty states appearing instantly and visibly
 * popping in. The PWA icons and the open-graph card stay PNG only: manifests and link-preview
 * crawlers do not negotiate formats.
 *
 *   pnpm --filter @crm/web brand
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { cleanTile } from './lib/object-tile.mjs';
import { blobs, collisions, groupByCell, maskOf, pad as padBox } from './lib/find-objects.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../../../assets/brand/source');
const pub = resolve(here, '../public');
const out = (...p) => resolve(pub, ...p);

/**
 * Writes `<base>.png`, `<base>.webp` and `<base>.avif` from one pipeline. Quality 85 is visually
 * lossless on these flat, hard-edged illustrations while still landing a tenth of the PNG size;
 * effort is turned up because this runs once at build time, never at request time.
 */
async function emit(pipeline, base) {
  // The PNG is encoded once, here, and written as those exact bytes: passing it back through
  // sharp would re-encode at the default compression level and make the fallback larger.
  const png = await pipeline.png({ compressionLevel: 9 }).toBuffer();
  await Promise.all([
    writeFile(`${base}.png`, png),
    sharp(png).webp({ quality: 85, effort: 6 }).toFile(`${base}.webp`),
    sharp(png).avif({ quality: 80, effort: 6 }).toFile(`${base}.avif`),
  ]);
}

const OBJECTS_1 = [
  'handset',
  'headset',
  'chat-bubble',
  'inbox-tray',
  'envelope',
  'calendar',
  'bell',
  'folder',
  'bar-chart',
  'funnel',
  'contact-card',
  'shield',
  'key',
  'magnifier',
  'upload',
  'spreadsheet',
  'chain',
  'unplugged',
  'clock',
  'checkmark',
];
const OBJECTS_2 = [
  'warning',
  'paper-plane',
  'rotary',
  'sim',
  'soundwave',
  'cassette',
  'stopwatch',
  'kanban',
  'pipeline',
  'map-pin',
  'tag',
  'coins',
  'handshake',
  'trophy',
  'hourglass',
  'lock',
  'filter',
  'table',
  'pencil',
  'sparkline',
];

async function sliceGrid(file, cols, rows, names, dir, opts = {}) {
  const image = sharp(resolve(src, file));
  const meta = await image.metadata();
  const cw = Math.floor(meta.width / cols);
  const ch = Math.floor(meta.height / rows);
  await mkdir(out(dir), { recursive: true });
  let n = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const name = names[n++];
      if (!name) continue;
      const inset = Math.round(Math.min(cw, ch) * (opts.inset ?? 0.02));
      let tile = await sharp(resolve(src, file))
        .extract({
          left: c * cw + inset,
          top: r * ch + inset,
          width: cw - inset * 2,
          height: ch - inset * 2,
        })
        .png()
        .toBuffer();
      const size = opts.size ?? 256;
      if (opts.object) {
        // cleaned, then padded into a square so every object shares a baseline
        const cut = await cleanTile(tile);
        await emit(
          sharp({
            create: {
              width: size,
              height: size,
              channels: 4,
              background: { r: 0, g: 0, b: 0, alpha: 0 },
            },
          }).composite([
            {
              input: await sharp(cut)
                .resize(Math.round(size * 0.92), Math.round(size * 0.92), {
                  fit: 'inside',
                  background: { r: 0, g: 0, b: 0, alpha: 0 },
                })
                .png()
                .toBuffer(),
              gravity: 'centre',
            },
          ]),
          out(dir, name),
        );
      } else {
        await emit(
          sharp(tile)
            .trim({ threshold: 1 })
            .resize(size, size, {
              fit: 'contain',
              background: { r: 0, g: 0, b: 0, alpha: 0 },
            }),
          out(dir, name),
        );
      }
    }
  }
  console.log(`${dir}: ${String(names.length)} files x3 formats`);
}

/**
 * Cuts the objects out of a sheet by finding them rather than by assuming a grid.
 *
 * The generator puts the objects roughly, not exactly, on a grid, so a fixed cut clipped some and
 * left a corner of the next one inside others. Here each object's own bounding box is measured, and
 * the 6 percent of breathing room added around it is then clipped back so that it can never reach
 * into a neighbour's box. That is what keeps a fragment of the handset's cord out of the headset.
 *
 * Anything whose own box genuinely overlaps another's is reported by name rather than written: two
 * objects that were rendered touching cannot be separated by arithmetic and want a hand.
 */
async function sliceObjects(file, cols, rows, names, dir, { size = 512 } = {}) {
  const source = resolve(src, file);
  const { data, info } = await sharp(source)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const found = groupByCell(
    blobs(
      maskOf({ data, width: info.width, height: info.height, channels: info.channels }),
      info.width,
      info.height,
      {
        minArea: 200,
      },
    ),
    cols,
    rows,
    info.width,
    info.height,
  );
  if (found.length !== names.length) {
    throw new Error(
      `${file}: found ${String(found.length)} objects for ${String(names.length)} names`,
    );
  }

  const touching = collisions(found, names);
  if (touching.length > 0) {
    for (const [a, b] of touching) console.warn(`  ${file}: ${a} and ${b} overlap; re-cut by hand`);
  }
  const skip = new Set(touching.flat());

  await mkdir(out(dir), { recursive: true });
  const sheet = [];
  for (const [i, name] of names.entries()) {
    if (skip.has(name)) continue;
    const box = found[i];
    // Breathing room, then pulled back off every neighbour so no fragment can come with it.
    let room = padBox(box, 0.06, info.width, info.height);
    for (const [j, other] of found.entries()) {
      if (i === j) continue;
      if (other.left >= box.left + box.width)
        room.width = Math.min(room.width, other.left - room.left);
      if (other.top >= box.top + box.height)
        room.height = Math.min(room.height, other.top - room.top);
      if (other.left + other.width <= box.left) {
        const edge = other.left + other.width;
        room.width -= Math.max(0, edge - room.left);
        room.left = Math.max(room.left, edge);
      }
      if (other.top + other.height <= box.top) {
        const edge = other.top + other.height;
        room.height -= Math.max(0, edge - room.top);
        room.top = Math.max(room.top, edge);
      }
    }
    const cut = await sharp(source)
      .extract({
        left: room.left,
        top: room.top,
        width: Math.max(1, room.width),
        height: Math.max(1, room.height),
      })
      .png()
      .toBuffer();
    const inner = await sharp(cut)
      .resize(Math.round(size * 0.92), Math.round(size * 0.92), {
        fit: 'inside',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
    const squared = sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    }).composite([{ input: inner, gravity: 'centre' }]);
    await emit(squared, out(dir, name));
    sheet.push({ name, png: await squared.png().toBuffer() });
  }

  console.log(`${dir}: ${String(sheet.length)} of ${String(names.length)} written`);
  return { touching, sheet };
}

/** Every slice at thumbnail size with its filename under it, so the set can be judged in one look. */
async function contactSheet(items, target) {
  if (items.length === 0) return;
  const cell = 180;
  const label = 26;
  const cols = 8;
  const rows = Math.ceil(items.length / cols);
  const width = cols * cell;
  const height = rows * (cell + label);
  const thumbs = await Promise.all(
    items.map(async ({ png }, i) => ({
      input: await sharp(png)
        .resize(cell - 16, cell - 16, { fit: 'inside' })
        .png()
        .toBuffer(),
      left: (i % cols) * cell + 8,
      top: Math.floor(i / cols) * (cell + label) + 8,
    })),
  );
  const text = items
    .map(({ name }, i) => {
      const x = (i % cols) * cell + cell / 2;
      const y = Math.floor(i / cols) * (cell + label) + cell + 16;
      return `<text x="${String(x)}" y="${String(y)}" fill="#A3A19C" font-family="monospace" font-size="12" text-anchor="middle">${name}</text>`;
    })
    .join('');
  await sharp({
    create: { width, height, channels: 4, background: { r: 10, g: 10, b: 12, alpha: 1 } },
  })
    .composite([
      ...thumbs,
      {
        input: Buffer.from(
          `<svg width="${String(width)}" height="${String(height)}">${text}</svg>`,
        ),
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toFile(target);
  console.log('contact sheet:', target);
}

async function main() {
  await mkdir(out('brand'), { recursive: true });

  // 1. objects: found on the sheet rather than cut on a grid, then checked for neighbours
  const first = await sliceObjects(
    '03-empty-state-objects-batch-1.png',
    5,
    4,
    OBJECTS_1,
    'brand/objects',
  );
  const second = await sliceObjects(
    '04-empty-state-objects-batch-2.png',
    5,
    4,
    OBJECTS_2,
    'brand/objects',
  );
  // One sheet for the whole set: the point is to judge forty slices in a single look.
  await contactSheet([...first.sheet, ...second.sheet], out('brand', 'objects-sheet.png'));
  const unresolved = [...first.touching, ...second.touching];
  if (unresolved.length > 0) {
    console.warn(`${String(unresolved.length)} object pairs need a hand; see the warnings above`);
  }

  // 2. abstract avatars (4x4, already transparent)
  const avatars = Array.from(
    { length: 16 },
    (_, i) => `abstract-${String(i + 1).padStart(2, '0')}`,
  );
  await sliceGrid('08-avatar-placeholders.png', 4, 4, avatars, 'brand/avatars', {
    size: 128,
    inset: 0.04,
  });

  // 3. login hero: left half dark, right half light
  const hero = sharp(resolve(src, '07-login-hero-v1.png'));
  const hm = await hero.metadata();
  const half = Math.floor(hm.width / 2);
  await emit(
    sharp(resolve(src, '07-login-hero-v1.png')).extract({
      left: 0,
      top: 0,
      width: half,
      height: hm.height,
    }),
    out('brand/hero-dark'),
  );
  await emit(
    sharp(resolve(src, '07-login-hero-v1.png')).extract({
      left: half,
      top: 0,
      width: hm.width - half,
      height: hm.height,
    }),
    out('brand/hero-light'),
  );

  // 4. open-graph card
  await sharp(resolve(src, '09-og-image-v2.png'))
    .resize(1200, 630, { fit: 'cover', position: 'centre' })
    .png({ compressionLevel: 9 })
    .toFile(out('brand/og.png'));

  // 5. icons rasterised from the vector mark
  const appIcon = out('brand/app-icon.svg');
  const markSvg = out('brand/mark.svg');
  const raster = async (file, size, target, background) => {
    const inner = await sharp(file, { density: 512 })
      .resize(
        background ? Math.round(size * 0.56) : size,
        background ? Math.round(size * 0.56) : size,
        {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      )
      .png()
      .toBuffer();
    await sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: background ?? { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: inner, gravity: 'centre' }])
      .png({ compressionLevel: 9 })
      .toFile(target);
  };
  await raster(appIcon, 192, out('icon-192.png'));
  await raster(appIcon, 512, out('icon-512.png'));
  await raster(appIcon, 180, out('apple-touch-icon.png'));
  await raster(markSvg, 512, out('maskable-512.png'), { r: 11, g: 11, b: 12, alpha: 1 });
  // The listing icon app stores and Meta ask for: 1024 square, on the brand's own dark ground.
  // Transparency is not allowed a listing, and a mark floating on whatever colour the reviewer's
  // page happens to be is not the mark anybody designed.
  await raster(markSvg, 1024, out('brand/app-icon-1024.png'), { r: 11, g: 11, b: 12, alpha: 1 });

  await writeFile(
    out('brand/.generated'),
    'Everything here is produced by scripts/build-brand-assets.mjs from assets/brand/source. Do not edit by hand.\n',
  );
  console.log('brand assets written to', pub);
}

await main();
