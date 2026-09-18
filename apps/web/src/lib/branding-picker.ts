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

/**
 * The tallest a stored logo needs to be.
 *
 * The sidebar shows it at 28 physical pixels, so this is already four times what the densest screen
 * asks for. Anything beyond it is bytes counted against the customer's storage for no visible gain.
 */
const MAX_LOGO_EDGE = 512;

/** Below this a file is already small enough that re-encoding would only cost it sharpness. */
const LEAVE_ALONE_BYTES = 300 * 1024;

/**
 * A logo cut down to the size it is actually displayed at, before it is uploaded.
 *
 * Somebody choosing a logo reaches for the picture they have, and the picture they have is often a
 * photo off a phone at eight megabytes. Refusing it is technically correct and useless: the file is
 * fine, it is merely enormous, and the browser can fix that without asking. So it is drawn at the
 * size the sidebar needs and re-encoded, which turns megabytes into tens of kilobytes and takes the
 * size limit out of the conversation entirely.
 *
 * WebP because it keeps transparency, which a logo usually depends on, at a fraction of PNG's size.
 * A file that is already small is returned untouched rather than re-encoded, since a crisp small PNG
 * has nothing to gain from a second pass through a lossy encoder.
 *
 * Anything the browser cannot decode comes back unchanged for the server to refuse by type, with the
 * reason named. HEIC from an iPhone is the case that matters: no browser decodes it, so it has to be
 * exported first, and saying so is more use than shrinking it silently would have been.
 */
export async function prepareLogo(file: File): Promise<File> {
  let bitmap: ImageBitmap;
  try {
    /*
     * The decoder is told the size we want up front. Without the hint a 10000 by 10000 photo is
     * decoded whole first, which is 400 MB of bitmap on a phone, and a tab that runs out of memory
     * there falls back to sending the original file, producing exactly the refusal this function
     * exists to prevent. Only the width is given: with both, the decoder stretches the image to fit
     * exactly and the logo comes out squashed, whereas one dimension keeps the proportions. The
     * scaling below still runs, so an image that is tall and narrow is brought back to size there.
     */
    bitmap = await createImageBitmap(file, { resizeWidth: MAX_LOGO_EDGE, resizeQuality: 'high' });
  } catch {
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      return file; // not an image this browser can decode, such as HEIC
    }
  }
  const longest = Math.max(bitmap.width, bitmap.height);
  // Re-encoded whenever the type is not one the server accepts, however small: a GIF or an AVIF the
  // browser can decode is worth converting rather than letting the upload be refused for its type.
  const servable =
    file.type === 'image/png' || file.type === 'image/jpeg' || file.type === 'image/webp';
  if (servable && longest <= MAX_LOGO_EDGE && file.size <= LEAVE_ALONE_BYTES) {
    bitmap.close();
    return file;
  }

  const scale = Math.min(1, MAX_LOGO_EDGE / longest);
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/webp', 0.92);
  });
  // A browser that will not give us WebP keeps its original file; the server's limit still applies.
  if (!blob || blob.size === 0 || blob.type !== 'image/webp') return file;
  return new File([blob], 'logo.webp', { type: 'image/webp' });
}

/** The palette a chosen accent produces, for previewing before it is saved. */
export function previewPalette(accent: string): BrandPalette {
  return generateBrandPalette(accent);
}
