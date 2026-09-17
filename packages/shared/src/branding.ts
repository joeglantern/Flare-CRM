/**
 * A customer's own colours, derived from one accent and applied as theme tokens (docs/18 §3).
 *
 * A brand colour is not a palette. The app needs a hover, a pressed, a link colour that survives a
 * black background, a subtle surface and a readable foreground on top of it, in both themes, and a
 * logo yields exactly one colour. So one seed goes in and a whole ramp comes out.
 *
 * The ramp is built in OKLCH rather than by lightening and darkening in HSL. HSL shifts hue as it
 * approaches the ends of its range, so a ramp built that way drifts, and the same recipe applied to
 * a blue and to a yellow produces two ramps with different perceived contrast. OKLCH steps in
 * perceptual lightness, so one recipe holds for any hue a customer brings.
 *
 * Contrast is enforced rather than hoped for. A pale logo yields a pale accent, and a pale accent
 * on paper is an unreadable link and an invisible button; where a role has to stay legible against
 * a known background, its lightness is moved until it is. That check is the reason this is a
 * function and not a table of colours.
 */
import { clampChroma, converter, formatHex, parse, wcagContrast } from 'culori';
import { z } from 'zod';

/** The mark Flare ships with, and what a customer's theme resets to. */
export const DEFAULT_ACCENT = '#FF6A3D';

const hex = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'A colour looks like #RRGGBB');

/** The resolved variables for one theme. Stored, not recomputed, so a theme never shifts by itself. */
export const themeTokens = z.record(z.string(), hex);
export type ThemeTokens = z.infer<typeof themeTokens>;

export const brandPalette = z.object({
  /** The colour everything else was derived from. */
  accent: hex,
  dark: themeTokens,
  light: themeTokens,
});
export type BrandPalette = z.infer<typeof brandPalette>;

export const brandingSettings = z.object({
  /** Object-store key of the customer's logo, shown where the Flare wordmark otherwise sits. */
  logoKey: z.string().max(200).nullable(),
  /** Null means the customer has not chosen, and the Flare palette applies. */
  accent: hex.nullable(),
  palette: brandPalette.nullable(),
});
export type BrandingSettings = z.infer<typeof brandingSettings>;

export const brandingDefaults: BrandingSettings = { logoKey: null, accent: null, palette: null };

/**
 * Built on first use, not at module load. A top-level call to an imported function counts as a side
 * effect to a bundler, which keeps the colour library in whatever chunk this module lands in; almost
 * every page needs `brandingDefaults` from here and none of them need the generator.
 */
let converterCache: ReturnType<typeof converter<'oklch'>> | null = null;
function oklch(value: ReturnType<typeof parse>) {
  converterCache ??= converter('oklch');
  return converterCache(value);
}

/**
 * Where each step sits relative to the seed, and how much colour it can hold there.
 *
 * The seed is step 500 exactly: a brand colour that comes back subtly different from the one the
 * customer gave is a bug, however well judged the adjustment. Everything else is placed around it.
 * Chroma falls away towards both ends because sRGB cannot hold much of it there, and a step that
 * asks for more than the gamut allows comes back clipped and off-hue.
 */
const STEPS = [
  { name: '100', dl: 0.26, cs: 0.35 },
  { name: '300', dl: 0.13, cs: 0.65 },
  { name: '400', dl: 0.06, cs: 0.85 },
  { name: '500', dl: 0, cs: 1 },
  { name: '600', dl: -0.08, cs: 1 },
  { name: '700', dl: -0.18, cs: 0.9 },
  { name: '950', dl: -0.48, cs: 0.5 },
] as const;

type StepName = (typeof STEPS)[number]['name'];
type Ramp = Record<StepName, string>;

interface Oklch {
  mode: 'oklch';
  l: number;
  c: number;
  h: number;
}

function toOklch(value: string): Oklch {
  const parsed = oklch(parse(value));
  if (!parsed) throw new Error(`Not a colour: ${value}`);
  return { mode: 'oklch', l: parsed.l, c: parsed.c, h: parsed.h ?? 0 };
}

/** Into sRGB, clipping chroma rather than letting the conversion clip the channels and shift hue. */
function toHex(color: Oklch): string {
  return formatHex(clampChroma({ ...color, l: clamp(color.l, 0, 1) }, 'oklch', 'rgb'));
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function rampFrom(seed: Oklch): Ramp {
  const out = {} as Ramp;
  for (const step of STEPS) {
    out[step.name] = toHex({
      mode: 'oklch',
      l: clamp(seed.l + step.dl, 0.05, 0.985),
      c: seed.c * step.cs,
      h: seed.h,
    });
  }
  return out;
}

/**
 * The same colour, moved until it can be read on `against`.
 *
 * Lightness only: hue is the brand and chroma is what makes it feel like the brand, so neither is
 * touched until the gamut forces it. Steps are small enough that a colour which already passes is
 * returned untouched, and a colour that cannot pass at any lightness returns its closest attempt
 * rather than looping.
 */
function readableOn(color: Oklch, against: string, target: number, lighten: boolean): string {
  let candidate = color;
  for (let i = 0; i < 40; i++) {
    const asHex = toHex(candidate);
    if (wcagContrast(asHex, against) >= target) return asHex;
    const next = candidate.l + (lighten ? 0.02 : -0.02);
    if (next <= 0.05 || next >= 0.985) return asHex;
    candidate = { ...candidate, l: next };
  }
  return toHex(candidate);
}

/** Black or white, whichever can actually be read on this colour. */
function foregroundFor(background: string): string {
  const onDark = wcagContrast(background, '#17171A');
  const onLight = wcagContrast(background, '#FFFFFF');
  return onDark >= onLight ? '#17171A' : '#FFFFFF';
}

const DARK_BG = '#000000';
const LIGHT_BG = '#FAFAF8';

/**
 * A full theme from one colour.
 *
 * Roles differ between themes on purpose: hover moves away from the background in each, so it is
 * the lighter step on black and the darker one on paper.
 */
export function generateBrandPalette(accent: string): BrandPalette {
  const seed = toOklch(accent);
  const ramp = rampFrom(seed);
  const seedHex = ramp['500'];

  const at = (name: StepName): Oklch => toOklch(ramp[name]);

  // Links sit on the page background rather than on the accent, so they are the roles most likely
  // to fail: a mid orange is fine on black and barely visible on paper.
  const linkDark = readableOn(at('300'), DARK_BG, 4.5, true);
  const linkLight = readableOn(at('700'), LIGHT_BG, 4.5, false);
  const onSubtleDark = readableOn(at('300'), ramp['950'], 4.5, true);
  const onSubtleLight = readableOn(at('700'), ramp['100'], 4.5, false);

  const rampTokens: ThemeTokens = Object.fromEntries(
    STEPS.map((s) => [`--flare-${s.name}`, ramp[s.name]]),
  );

  return {
    accent: seedHex,
    dark: {
      ...rampTokens,
      '--flare': seedHex,
      '--flare-hover': ramp['400'],
      '--flare-pressed': ramp['600'],
      '--flare-link': linkDark,
      '--flare-subtle': ramp['950'],
      '--flare-on-subtle': onSubtleDark,
      '--on-flare': foregroundFor(seedHex),
      '--chart-1': seedHex,
    },
    light: {
      ...rampTokens,
      '--flare': seedHex,
      '--flare-hover': ramp['600'],
      '--flare-pressed': ramp['700'],
      '--flare-link': linkLight,
      '--flare-subtle': ramp['100'],
      '--flare-on-subtle': onSubtleLight,
      '--on-flare': foregroundFor(seedHex),
      '--chart-1': seedHex,
    },
  };
}

/**
 * Candidate accents from a logo, most usable first.
 *
 * Callers hand in colours already extracted from the image; this only decides which are worth
 * offering. A logo is mostly background, so the colours that appear most are usually white, black
 * or something near them, and offering those as an accent produces an invisible button. Anything
 * too grey to read as a colour, or so light or dark that a ramp around it would collapse, is left
 * out.
 */
export function usableAccents(colors: string[]): string[] {
  const seen = new Set<string>();
  const out: { hex: string; score: number }[] = [];
  for (const color of colors) {
    let c: Oklch;
    try {
      c = toOklch(color);
    } catch {
      continue;
    }
    if (c.c < 0.04) continue;
    if (c.l < 0.25 || c.l > 0.9) continue;
    const asHex = toHex(c);
    if (seen.has(asHex)) continue;
    seen.add(asHex);
    // Mid lightness and decent saturation make the most workable accent.
    out.push({ hex: asHex, score: c.c * 2 - Math.abs(c.l - 0.62) });
  }
  return out.sort((a, b) => b.score - a.score).map((x) => x.hex);
}
