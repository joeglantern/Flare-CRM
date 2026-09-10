/**
 * Slices the generated sheets in assets/site/source into the plates and textures the site serves.
 *
 * The sheets arrive as grids with white gutters between the cells, so the gutters are found by
 * looking for rows and columns that are bright all the way across rather than by hard coding
 * pixel positions: the generator does not return the same canvas size twice.
 *
 * Every plate sits behind text, so it is written as AVIF and WebP only. There is no PNG fallback
 * on purpose: a browser too old for either is a browser that will show the page's own background
 * colour, which is what these are painted over anyway.
 *
 *   node apps/site/scripts/build-site-assets.mjs
 */
import { mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
// The finder lives with the brand pipeline because that is where objects have always been cut;
// the mascot needs exactly the same treatment, so it is imported rather than written twice.
import {
  blobs,
  collisions,
  groupByCell,
  maskOf,
  pad as padBox,
} from '../../web/scripts/lib/find-objects.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../../../assets/site/source');
const pub = resolve(here, '../public');

/** Rows or columns that are bright across their whole length: the white gutters between cells. */
function gutters(values, threshold = 200, minRun = 2) {
  const runs = [];
  let start = null;
  values.forEach((v, i) => {
    if (v > threshold) {
      if (start === null) start = i;
      return;
    }
    if (start !== null && i - start >= minRun) runs.push([start, i - 1]);
    if (start !== null) start = null;
  });
  if (start !== null && values.length - start >= minRun) runs.push([start, values.length - 1]);
  return runs;
}

/** The cell boundaries along one axis, given the gutters found on it. */
function bands(length, runs) {
  const edges = [0];
  for (const [a, b] of runs) {
    edges.push(a, b + 1);
  }
  edges.push(length);
  const out = [];
  for (let i = 0; i < edges.length; i += 2) {
    const from = edges[i];
    const to = edges[i + 1];
    if (to - from > 32) out.push([from, to - from]);
  }
  return out;
}

async function slice(file, names, { quality }) {
  const image = sharp(resolve(src, file));
  const { width, height } = await image.metadata();
  const grey = await image.clone().greyscale().raw().toBuffer();

  const rowMean = [];
  const colMean = [];
  for (let y = 0; y < height; y += 1) {
    let sum = 0;
    for (let x = 0; x < width; x += 1) sum += grey[y * width + x];
    rowMean.push(sum / width);
  }
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let y = 0; y < height; y += 1) sum += grey[y * width + x];
    colMean.push(sum / height);
  }

  const rows = bands(height, gutters(rowMean));
  const cols = bands(width, gutters(colMean));
  const cells = [];
  for (const [top, cellHeight] of rows) {
    for (const [left, cellWidth] of cols) {
      // Two pixels in from the gutter, because the white bleeds into the cell edge.
      cells.push({ left: left + 2, top: top + 2, width: cellWidth - 4, height: cellHeight - 4 });
    }
  }
  if (cells.length !== names.length) {
    throw new Error(
      `${file}: found ${String(cells.length)} cells for ${String(names.length)} names`,
    );
  }

  for (const [i, name] of names.entries()) {
    const cell = sharp(resolve(src, file)).extract(cells[i]).removeAlpha();
    const target = resolve(pub, name);
    await mkdir(dirname(target), { recursive: true });
    await Promise.all([
      cell.clone().avif({ quality, effort: 9 }).toFile(`${target}.avif`),
      cell
        .clone()
        .webp({ quality: quality + 10, effort: 6 })
        .toFile(`${target}.webp`),
    ]);
    const written = await stat(`${target}.avif`);
    const shape = await sharp(`${target}.avif`).metadata();
    console.log(
      `${name}.avif`,
      `${String(shape.width)}x${String(shape.height)}`,
      `${String(Math.round(written.size / 1024))} KB`,
    );
  }
}

/**
 * The figure sheets have no gutters: the character is rendered against pure black so that
 * mix-blend-mode: screen can drop the background out, hair and cape edges included.
 *
 * Each figure is found rather than cut on a grid, the same way the object set is, because a cape
 * or an outstretched arm crosses a nominal cell boundary and a fixed cut takes the arm off. The
 * padded box is then pulled back off every neighbour so no fragment travels with it.
 */
async function sliceFigures(file, rows, cols, names, { quality = 62, threshold = 26 } = {}) {
  const source = resolve(src, file);
  const { data, info } = await sharp(source).raw().toBuffer({ resolveWithObject: true });
  const found = groupByCell(
    blobs(
      maskOf(
        { data, width: info.width, height: info.height, channels: info.channels },
        { threshold },
      ),
      info.width,
      info.height,
      { minArea: 400 },
    ),
    cols,
    rows,
    info.width,
    info.height,
  );
  if (found.length !== names.length) {
    throw new Error(
      `${file}: found ${String(found.length)} figures for ${String(names.length)} names`,
    );
  }
  const touching = collisions(found, names);
  for (const [a, b] of touching) console.warn(`  ${file}: ${a} and ${b} overlap; re-cut by hand`);
  const skip = new Set(touching.flat());

  const sheet = [];
  for (const [i, name] of names.entries()) {
    if (skip.has(name)) continue;
    const box = found[i];
    const room = padBox(box, 0.06, info.width, info.height);
    for (const [j, other] of found.entries()) {
      if (i === j) continue;
      if (other.left >= box.left + box.width) {
        room.width = Math.min(room.width, other.left - room.left);
      }
      if (other.top >= box.top + box.height) {
        room.height = Math.min(room.height, other.top - room.top);
      }
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
    const target = resolve(pub, name);
    await mkdir(dirname(target), { recursive: true });
    const png = await sharp(source)
      .extract({
        left: room.left,
        top: room.top,
        width: Math.max(1, room.width),
        height: Math.max(1, room.height),
      })
      .png()
      .toBuffer();
    await Promise.all([
      sharp(png).avif({ quality, effort: 9 }).toFile(`${target}.avif`),
      sharp(png)
        .webp({ quality: quality + 10, effort: 6 })
        .toFile(`${target}.webp`),
    ]);
    const written = await stat(`${target}.avif`);
    const shape = await sharp(`${target}.avif`).metadata();
    console.log(
      `${name}.avif`,
      `${String(shape.width)}x${String(shape.height)}`,
      `${String(Math.round(written.size / 1024))} KB`,
    );
    sheet.push({ name, png });
  }
  return sheet;
}

/** Every slice at thumbnail size with its name under it, so the set can be judged in one look. */
async function contactSheet(items, target) {
  if (items.length === 0) return;
  const cell = 190;
  const label = 26;
  const cols = 6;
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
      return `<text x="${String(x)}" y="${String(y)}" fill="#A3A19C" font-family="monospace" font-size="12" text-anchor="middle">${name.split('/').pop() ?? name}</text>`;
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

await slice(
  'sheet-a-plates.png',
  ['plates/ember', 'plates/cloud-layers', 'plates/city-under-cloud', 'plates/light-shaft'],
  { quality: 42 },
);

await slice(
  'sheet-c-surfaces.png',
  [
    'textures/grain',
    'textures/brushed-metal',
    'textures/smoked-glass',
    'textures/grid',
    'textures/dust',
    'textures/falloff',
  ],
  { quality: 40 },
);

console.log('site assets written to', pub);

const poses = await sliceFigures('mascot-poses.png', 4, 4, [
  'mascot/arms-folded',
  'mascot/flying',
  'mascot/pointing',
  'mascot/on-the-phone',
  'mascot/headset',
  'mascot/reading',
  'mascot/shrug',
  'mascot/asleep',
  'mascot/paper-plane',
  'mascot/shield',
  'mascot/waving',
  'mascot/magnifier',
  'mascot/tangled',
  'mascot/celebrating',
  'mascot/folders',
  'mascot/peeking',
]);

const faces = await sliceFigures('mascot-faces.png', 3, 3, [
  'mascot/face-smiling',
  'mascot/face-steady',
  'mascot/face-sceptical',
  'mascot/face-laughing',
  'mascot/face-headset',
  'mascot/face-thinking',
  'mascot/hand-thumbs-up',
  'mascot/hand-wave',
  'mascot/emblem',
]);

const sparks = await sliceFigures(
  'spark-trio.png',
  1,
  3,
  ['spark/solid', 'spark/outline', 'spark/ash'],
  { quality: 70 },
);

const dive = await sliceFigures('mascot-dive.png', 1, 1, ['mascot/dive'], { quality: 66 });

await contactSheet([...poses, ...faces, ...dive, ...sparks], resolve(pub, 'mascot-sheet.png'));
