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
 *   pnpm --filter @crm/web brand
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { cleanTile } from './lib/object-tile.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../../../assets/brand/source');
const pub = resolve(here, '../public');
const out = (...p) => resolve(pub, ...p);

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
        await sharp({
          create: {
            width: size,
            height: size,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          },
        })
          .composite([
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
          ])
          .png({ compressionLevel: 9 })
          .toFile(out(dir, `${name}.png`));
      } else {
        await sharp(tile)
          .trim({ threshold: 1 })
          .resize(size, size, {
            fit: 'contain',
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          })
          .png({ compressionLevel: 9 })
          .toFile(out(dir, `${name}.png`));
      }
    }
  }
  console.log(`${dir}: ${String(names.length)} files`);
}

async function main() {
  await mkdir(out('brand'), { recursive: true });

  // 1. objects (two 5x4 grids: 5 columns, 4 rows)
  await sliceGrid('03-empty-state-objects-batch-1.png', 5, 4, OBJECTS_1, 'brand/objects', {
    object: true,
    size: 256,
  });
  await sliceGrid('04-empty-state-objects-batch-2.png', 5, 4, OBJECTS_2, 'brand/objects', {
    object: true,
    size: 256,
  });

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
  await sharp(resolve(src, '07-login-hero-v1.png'))
    .extract({ left: 0, top: 0, width: half, height: hm.height })
    .png({ compressionLevel: 9 })
    .toFile(out('brand/hero-dark.png'));
  await sharp(resolve(src, '07-login-hero-v1.png'))
    .extract({ left: half, top: 0, width: hm.width - half, height: hm.height })
    .png({ compressionLevel: 9 })
    .toFile(out('brand/hero-light.png'));

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

  await writeFile(
    out('brand/.generated'),
    'Everything here is produced by scripts/build-brand-assets.mjs from assets/brand/source. Do not edit by hand.\n',
  );
  console.log('brand assets written to', pub);
}

await main();
