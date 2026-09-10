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
 * mix-blend-mode: screen can drop the background out, hair and cape edges included. So the grid is
 * divided evenly and each cell is then trimmed back to its own content.
 */
async function sliceFigures(file, rows, cols, names, { quality = 62 } = {}) {
  const source = resolve(src, file);
  const { width, height } = await sharp(source).metadata();
  const cellWidth = Math.floor(width / cols);
  const cellHeight = Math.floor(height / rows);
  let i = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const name = names[i];
      i += 1;
      if (!name) continue;
      const target = resolve(pub, name);
      await mkdir(dirname(target), { recursive: true });
      // Cells are exported whole rather than trimmed to the figure. The black around each one is
      // invisible once it is composited with screen, every pose comes out the same size, which
      // makes them interchangeable in a layout, and trimming a near-black edge is guesswork.
      const cell = sharp(source).extract({
        left: col * cellWidth,
        top: row * cellHeight,
        width: cellWidth,
        height: cellHeight,
      });
      const png = await cell.png().toBuffer();
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
    }
  }
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

await sliceFigures('mascot-poses.png', 4, 4, [
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

await sliceFigures('mascot-faces.png', 3, 3, [
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

await sliceFigures('spark-trio.png', 1, 3, ['spark/solid', 'spark/outline', 'spark/ash'], {
  quality: 70,
});

await sliceFigures('mascot-dive.png', 1, 1, ['mascot/dive'], { quality: 66 });
