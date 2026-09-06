/**
 * Cleans one sliced object tile.
 *
 * The master grids are rendered with a real alpha channel, so there is no background to key out
 * and nothing to matte. The only damage a slice can do is drag in a sliver of the neighbouring
 * cell, so this drops alpha components that bleed in from the tile border, drops stray specks,
 * and trims the transparent margin. The artwork itself is never touched.
 */
import sharp from 'sharp';

const OPAQUE = 8; // alpha above this counts as artwork

export async function cleanTile(buffer, options = {}) {
  const { borderKeep = 0.15, speckKeep = 0.004 } = options;

  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: c } = info;

  const label = new Int32Array(w * h).fill(-1);
  const areas = [];
  const touchesBorder = [];
  const stack = [];

  for (let start = 0; start < w * h; start++) {
    if (label[start] !== -1) continue;
    if (data[start * c + 3] <= OPAQUE) continue;
    const id = areas.length;
    areas.push(0);
    touchesBorder.push(false);
    label[start] = id;
    stack.push(start);
    while (stack.length > 0) {
      const p = stack.pop();
      const x = p % w;
      const y = (p - x) / w;
      areas[id]++;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesBorder[id] = true;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const np = ny * w + nx;
        if (label[np] !== -1) continue;
        if (data[np * c + 3] <= OPAQUE) continue;
        label[np] = id;
        stack.push(np);
      }
    }
  }

  if (areas.length === 0) return sharp(buffer).png({ compressionLevel: 9 }).toBuffer();

  let biggest = 0;
  for (let i = 1; i < areas.length; i++) if (areas[i] > areas[biggest]) biggest = i;
  const largest = areas[biggest];

  const keep = areas.map((area, i) => {
    if (i === biggest) return true;
    if (area < largest * speckKeep) return false; // dust from the render
    if (touchesBorder[i]) return area >= largest * borderKeep; // neighbour bleeding in
    return true; // a genuine detached part: a shadow, a second link, a floating row
  });

  for (let p = 0; p < w * h; p++) {
    const id = label[p];
    if (id !== -1 && !keep[id]) {
      data[p * c + 3] = 0;
    }
  }

  return sharp(data, { raw: { width: w, height: h, channels: c } })
    .trim({ threshold: 1 })
    .png({ compressionLevel: 9 })
    .toBuffer();
}
