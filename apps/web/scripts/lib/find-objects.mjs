/**
 * Finds where the objects actually are on a generated sheet, instead of assuming a grid.
 *
 * The sheets come back with the objects roughly, but not exactly, on a grid: one drifts into its
 * neighbour's cell, another sits high in its own. Cutting on fixed boundaries therefore clipped
 * some objects and left a fragment of the next one in the corner of others, which is what the
 * shipped set has been carrying.
 *
 * So: threshold the sheet into a mask, label the connected blobs, and merge blobs that are close
 * enough to be parts of one object (the funnel and its lines, the beads of a pipeline, the bars of
 * a soundwave). What comes back is one box per object, in reading order, and the caller can then
 * pad each box and check that no padded box reaches into another.
 */

/** Row-major mask: 1 where there is something, 0 where there is not. */
export function maskOf({ data, width, height, channels }, { threshold = 24 } = {}) {
  const mask = new Uint8Array(width * height);
  // An alpha channel that is opaque everywhere carries no information: the sheet was rendered on
  // black and then given a channel it does not use. Reading it would mark the whole canvas as
  // content, which is exactly the trap that made a sixteen pose sheet look like one object.
  let alphaVaries = false;
  if (channels === 4) {
    for (let p = 3; p < data.length; p += 4) {
      if (data[p] < 250) {
        alphaVaries = true;
        break;
      }
    }
  }
  const hasAlpha = channels === 4 && alphaVaries;
  for (let i = 0, p = 0; i < mask.length; i += 1, p += channels) {
    if (hasAlpha) {
      mask[i] = data[p + 3] > threshold ? 1 : 0;
      continue;
    }
    // No alpha: the sheet is drawn on black, so brightness is the subject.
    const luma = 0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2];
    mask[i] = luma > threshold ? 1 : 0;
  }
  return mask;
}

/** Every connected blob in the mask, eight-connected, as boxes with their pixel count. */
export function blobs(mask, width, height, { minArea = 64 } = {}) {
  const seen = new Uint8Array(mask.length);
  const out = [];
  const stack = new Int32Array(mask.length);
  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] === 0 || seen[start] === 1) continue;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let area = 0;
    while (top > 0) {
      const at = stack[--top];
      const x = at % width;
      const y = (at - x) / width;
      area += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (mask[next] === 1 && seen[next] === 0) {
            seen[next] = 1;
            stack[top++] = next;
          }
        }
      }
    }
    if (area >= minArea) {
      out.push({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1, area });
    }
  }
  return out;
}

const right = (b) => b.left + b.width;
const bottom = (b) => b.top + b.height;

function overlaps(a, b, margin = 0) {
  return (
    a.left - margin < right(b) + margin &&
    right(a) + margin > b.left - margin &&
    a.top - margin < bottom(b) + margin &&
    bottom(a) + margin > b.top - margin
  );
}

function union(a, b) {
  const left = Math.min(a.left, b.left);
  const top = Math.min(a.top, b.top);
  return {
    left,
    top,
    width: Math.max(right(a), right(b)) - left,
    height: Math.max(bottom(a), bottom(b)) - top,
    area: a.area + b.area,
  };
}

/**
 * Groups blobs into the cells of the sheet's nominal grid by where their centre falls, and unions
 * each cell's blobs into one box.
 *
 * Proximity alone does not work here: the gap between two objects is often smaller than the gap
 * between the funnel and its own lines, so any margin wide enough to join an object to its parts
 * also joins it to its neighbour. The grid is not accurate enough to cut on, but it is accurate
 * enough to say which object a blob belongs to, which is all this needs.
 */
export function groupByCell(boxes, cols, rows, width, height) {
  const cellWidth = width / cols;
  const cellHeight = height / rows;
  const cells = new Map();
  for (const box of boxes) {
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const col = Math.min(cols - 1, Math.max(0, Math.floor(cx / cellWidth)));
    const row = Math.min(rows - 1, Math.max(0, Math.floor(cy / cellHeight)));
    const key = row * cols + col;
    const found = cells.get(key);
    cells.set(key, found ? union(found, box) : box);
  }
  return [...cells.entries()]
    .sort(([a], [b]) => a - b)
    .map(([key, box]) => ({ ...box, cell: key }));
}

/** Merges blobs that are near enough to be parts of the same object, to a fixed point. */
export function cluster(boxes, joinMargin) {
  let current = boxes.slice();
  for (;;) {
    let merged = false;
    const next = [];
    for (const box of current) {
      const hit = next.findIndex((other) => overlaps(box, other, joinMargin));
      if (hit === -1) {
        next.push(box);
        continue;
      }
      next[hit] = union(next[hit], box);
      merged = true;
    }
    current = next;
    if (!merged) return current;
  }
}

/** Reading order: banded into rows by vertical centre, then left to right within each row. */
export function readingOrder(boxes, rowHeight) {
  return boxes
    .map((b) => ({ ...b, cx: b.left + b.width / 2, cy: b.top + b.height / 2 }))
    .sort((a, b) => {
      const rowA = Math.round(a.cy / rowHeight);
      const rowB = Math.round(b.cy / rowHeight);
      return rowA === rowB ? a.cx - b.cx : rowA - rowB;
    });
}

/** Pads a box by a fraction of its longest side, clamped to the sheet. */
export function pad(box, ratio, width, height) {
  const by = Math.round(Math.max(box.width, box.height) * ratio);
  const left = Math.max(0, box.left - by);
  const top = Math.max(0, box.top - by);
  return {
    left,
    top,
    width: Math.min(width - left, box.width + by * 2),
    height: Math.min(height - top, box.height + by * 2),
  };
}

/** Pairs of padded boxes that reach into one another. The caller re-cuts these by hand. */
export function collisions(padded, names) {
  const found = [];
  for (let i = 0; i < padded.length; i += 1) {
    for (let j = i + 1; j < padded.length; j += 1) {
      if (overlaps(padded[i], padded[j])) found.push([names[i], names[j]]);
    }
  }
  return found;
}
