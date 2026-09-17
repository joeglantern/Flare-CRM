/**
 * Applying a customer's colours to the document.
 *
 * Nothing here derives a palette: every screen loads this, and only the branding screen needs the
 * generator, which brings a colour library with it. Deriving one lives in `branding-picker.ts`.
 */
import type { BrandPalette } from '@crm/shared';

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
