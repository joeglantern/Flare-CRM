/**
 * Deriving a palette, and reading the colours out of a logo.
 *
 * Separate from `branding.ts` because this half pulls in a colour library and only the branding
 * screen needs it. Applying a palette that is already stored needs none of this.
 *
 * The colour maths lives in `@crm/shared` so it is tested without a browser; this file is the part
 * that needs a canvas: turning an image into a list of colours.
 */
import {
  accentCandidates,
  generateBrandPalette,
  type AccentCandidate,
  type BrandPalette,
} from '@crm/shared';

/**
 * How large the image is read at.
 *
 * Large enough that a small element keeps enough pixels to clear the noise floor below, small enough
 * that counting them is instant. A logo's colours are flat, so this is about not losing a thin
 * outline or a one-word tagline, not about fidelity.
 */
const SAMPLE_EDGE = 320;

/**
 * The share of counted pixels a colour needs before it is a colour rather than an artefact.
 *
 * Every edge in a logo is anti-aliased into a gradient between the shape and what is behind it, so a
 * two-colour logo really contains hundreds. Those blends are individually rare, and this is what
 * separates them from the handful of colours somebody actually chose.
 */
const NOISE_FLOOR = 0.002;

/** Below this a pixel is see-through enough that its colour is the canvas, not the logo. */
const MIN_ALPHA = 128;

/**
 * Every colour in a logo, most workable as an accent first.
 *
 * Counts exact colours rather than grouping them into a coarse RGB grid. The grid was the problem: at
 * 24 levels per channel it merged colours a person can plainly tell apart, so a logo with a red mark
 * and an orange one offered a single muddy average of the two, and the averaging invented colours
 * that were in no part of the image. Logos are flat, so counting exactly finds precisely the colours
 * that were chosen, and `accentCandidates` then merges only what is perceptually the same.
 *
 * Transparent pixels are skipped: a logo on transparency would otherwise average towards whatever the
 * canvas happened to be cleared to.
 */
export async function logoColors(file: Blob, limit = 14): Promise<AccentCandidate[]> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return []; // not an image this browser can decode
  }

  const scale = Math.min(1, SAMPLE_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    bitmap.close();
    return [];
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const { data } = ctx.getImageData(0, 0, w, h);
  const counts = new Map<number, number>();
  let counted = 0;
  for (let i = 0; i < data.length; i += 4) {
    if ((data[i + 3] ?? 0) < MIN_ALPHA) continue;
    // One integer per exact colour: cheaper than a string key and there are at most 16.7M of them.
    const rgb = ((data[i] ?? 0) << 16) | ((data[i + 1] ?? 0) << 8) | (data[i + 2] ?? 0);
    counts.set(rgb, (counts.get(rgb) ?? 0) + 1);
    counted++;
  }
  if (counted === 0) return [];

  const floor = Math.max(1, Math.floor(counted * NOISE_FLOOR));
  const byArea = [...counts.entries()]
    .filter(([, n]) => n >= floor)
    .sort((a, b) => b[1] - a[1])
    .map(([rgb]) => `#${rgb.toString(16).padStart(6, '0')}`);

  // Ordered by how much of the logo they cover, so the merge keeps the most prominent of each cluster.
  return accentCandidates(byArea).slice(0, limit);
}

/** The palette a chosen accent produces, for previewing before it is saved. */
export function previewPalette(accent: string): BrandPalette {
  return generateBrandPalette(accent);
}
