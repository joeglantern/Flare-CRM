/**
 * Applying a customer's colours, and pulling candidates out of their logo.
 *
 * The palette itself is generated in `@crm/shared` so the same recipe and the same contrast checks
 * apply wherever it is derived. This file is the browser half: reading pixels, and writing the
 * resolved tokens onto the document.
 */
import { generateBrandPalette, usableAccents, type BrandPalette } from '@crm/shared';

/** Tokens the stylesheet defines per theme, so removing an override restores the Flare value. */
const OVERRIDABLE = [
  '--flare',
  '--flare-hover',
  '--flare-pressed',
  '--flare-link',
  '--flare-subtle',
  '--flare-on-subtle',
  '--on-flare',
  '--chart-1',
  '--flare-100',
  '--flare-300',
  '--flare-400',
  '--flare-500',
  '--flare-600',
  '--flare-700',
  '--flare-950',
] as const;

/**
 * Writes a palette onto the document as inline custom properties.
 *
 * Inline rather than a generated stylesheet because these are the same variables the theme already
 * defines: setting them on the root element wins over the stylesheet without having to out-specify
 * it, and clearing them falls back to Flare's own values with nothing left behind.
 *
 * Which half of the palette applies follows the theme the user has chosen, so the observer watches
 * `data-theme` rather than the palette being reapplied by every screen that changes it.
 */
export function applyBrandPalette(palette: BrandPalette | null): void {
  const root = document.documentElement;
  if (palette === null) {
    for (const token of OVERRIDABLE) root.style.removeProperty(token);
    return;
  }
  const theme = root.getAttribute('data-theme') === 'light' ? palette.light : palette.dark;
  for (const token of OVERRIDABLE) {
    const value = theme[token];
    if (value === undefined) root.style.removeProperty(token);
    else root.style.setProperty(token, value);
  }
}

/** Reapplies the palette whenever the theme flips, since the two halves differ. */
export function watchThemeForPalette(getPalette: () => BrandPalette | null): () => void {
  const observer = new MutationObserver(() => {
    applyBrandPalette(getPalette());
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  return () => {
    observer.disconnect();
  };
}

/** How finely colours are grouped before being counted. Coarse on purpose: see `accentsFromImage`. */
const BUCKET = 24;

/**
 * The colours worth offering as an accent, read out of an image.
 *
 * The image is drawn small and its pixels are grouped into coarse buckets and counted, which is the
 * frequency half of what a dedicated palette library does. What makes the result usable is the
 * second half, in `usableAccents`: a logo is mostly background, so the colours that appear most are
 * almost always white, black or a near-grey, and offering those as an accent produces an invisible
 * button. Anything without enough colour in it, or too close to either end of the range to build a
 * ramp around, is dropped there rather than here.
 *
 * Transparent pixels are skipped outright: a logo on transparency would otherwise average towards
 * whatever the canvas was cleared to.
 */
export async function accentsFromImage(file: Blob, limit = 6): Promise<string[]> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 160 / Math.max(bitmap.width, bitmap.height));
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
  const counts = new Map<string, { count: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] ?? 0;
    if (alpha < 200) continue;
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    const key = `${Math.round(r / BUCKET)}-${Math.round(g / BUCKET)}-${Math.round(b / BUCKET)}`;
    const seen = counts.get(key);
    if (seen) {
      seen.count += 1;
      seen.r += r;
      seen.g += g;
      seen.b += b;
    } else {
      counts.set(key, { count: 1, r, g, b });
    }
  }

  const byFrequency = [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 40)
    .map((bucket) => {
      const hex = (n: number) =>
        Math.round(n / bucket.count)
          .toString(16)
          .padStart(2, '0');
      return `#${hex(bucket.r)}${hex(bucket.g)}${hex(bucket.b)}`;
    });

  return usableAccents(byFrequency).slice(0, limit);
}

/** The palette a chosen accent produces, for previewing before it is saved. */
export function previewPalette(accent: string): BrandPalette {
  return generateBrandPalette(accent);
}
