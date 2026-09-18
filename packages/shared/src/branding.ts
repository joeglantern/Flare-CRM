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
import { clampChroma, converter, formatHex, inGamut, parse, wcagContrast } from 'culori';
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

/**
 * Into sRGB, clipping chroma rather than letting the conversion clip the channels and shift hue.
 *
 * A colour already inside the gamut is converted untouched. Clamping it anyway moved pure blue to
 * #0031e5 and pure cyan to #01ffff, because the round trip through OKLCH leaves float noise just
 * outside the boundary and the clamp then pulls the colour in from it. Visible, and on a seed it
 * breaks the one promise this file makes.
 */
function toHex(color: Oklch): string {
  const bounded = { ...color, l: clamp(color.l, 0, 1) };
  return formatHex(inGamut('rgb')(bounded) ? bounded : clampChroma(bounded, 'oklch', 'rgb'));
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function rampFrom(seed: Oklch): Ramp {
  const out = {} as Ramp;
  for (const step of STEPS) {
    // Step 500 is the seed itself, handed back exactly. Running it through the same clamp as the
    // rest turned a white brand into #fafafa, which is a different colour from the one given.
    out[step.name] =
      step.dl === 0
        ? toHex(seed)
        : toHex({
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

/**
 * Black or white, whichever reads better on the one background that cannot move.
 *
 * A primary button is three colours carrying one label: the accent at rest, and a lighter or darker
 * step on hover and on press. Only the first of those is fixed, because it is the brand. So the
 * label is chosen to suit the seed and the other two are moved to suit the label, rather than
 * choosing for the worst of the three and leaving the seed itself failing.
 *
 * That choice cannot fail. Whichever of black and white is better against a colour, the worst case
 * is a colour balanced exactly between them, and there the better one still reaches 4.58 to 1. The
 * near-black used for body text does not have that property, which is what left a mid red at 4.47.
 */
function foregroundFor(background: string): string {
  return wcagContrast(background, '#000000') >= wcagContrast(background, '#FFFFFF')
    ? '#000000'
    : '#FFFFFF';
}

/**
 * A surface the accent's own text sits on: a wash of the brand, not a step along its ramp.
 *
 * Relative steps break at the ends. Step 100 is the seed's lightness plus a fixed amount, so a black
 * logo gave a mid grey where a pale surface belongs, and no foreground could then be read on it. A
 * surface is an absolute thing, so it is stated absolutely and only takes its hue from the brand.
 */
function surfaceFor(seed: Oklch, lightness: number, maxChroma: number): string {
  return toHex({ mode: 'oklch', l: lightness, c: Math.min(seed.c * 0.4, maxChroma), h: seed.h });
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
  /*
   * The colour as it was given, not as it survives a round trip.
   *
   * Converting to OKLCH and back is lossy at the edge of the gamut: pure blue came back #0031e5 and
   * pure cyan #01ffff, because the conversion lands a hair outside sRGB and the clamp then pulls it
   * in. No tolerance fixes that in general, so the seed simply is not derived. It is the one value
   * here that was chosen rather than computed.
   */
  const seedHex = /^#[0-9a-f]{6}$/i.test(accent.trim()) ? accent.trim().toLowerCase() : ramp['500'];
  ramp['500'] = seedHex;

  const at = (name: StepName): Oklch => toOklch(ramp[name]);

  // Links sit on the page background rather than on the accent, so they are the roles most likely
  // to fail: a mid orange is fine on black and barely visible on paper.
  const linkDark = readableOn(at('300'), DARK_BG, 4.5, true);
  const linkLight = readableOn(at('700'), LIGHT_BG, 4.5, false);

  const subtleDark = surfaceFor(seed, 0.19, 0.045);
  const subtleLight = surfaceFor(seed, 0.95, 0.05);
  const onSubtleDark = readableOn(at('300'), subtleDark, 4.5, true);
  const onSubtleLight = readableOn(at('700'), subtleLight, 4.5, false);

  /*
   * A button's three states carry the same label, so the label is chosen against all three and then
   * the two derived states are moved until they clear it. The seed never moves: it is the brand, and
   * the states around it are ours to adjust. 4.5 rather than 3, because a button here is 12 to 13
   * pixels at weight 500, which is not the large text the lower bar is for.
   */
  const onDark = foregroundFor(seedHex);
  const onLight = foregroundFor(seedHex);
  // Away from the label: a dark label needs a lighter button under it, and the other way round.
  const lift = (c: Oklch, fg: string) => readableOn(c, fg, 4.5, fg === '#000000');

  const hoverDark = lift(at('400'), onDark);
  const pressedDark = lift(at('600'), onDark);
  const hoverLight = lift(at('600'), onLight);
  const pressedLight = lift(at('700'), onLight);

  const rampTokens: ThemeTokens = Object.fromEntries(
    STEPS.map((s) => [`--flare-${s.name}`, ramp[s.name]]),
  );

  return {
    accent: seedHex,
    dark: {
      ...rampTokens,
      '--flare': seedHex,
      '--flare-hover': hoverDark,
      '--flare-pressed': pressedDark,
      '--flare-link': linkDark,
      '--flare-subtle': subtleDark,
      '--flare-on-subtle': onSubtleDark,
      '--on-flare': onDark,
      '--chart-1': seedHex,
    },
    light: {
      ...rampTokens,
      '--flare': seedHex,
      '--flare-hover': hoverLight,
      '--flare-pressed': pressedLight,
      '--flare-link': linkLight,
      '--flare-subtle': subtleLight,
      '--flare-on-subtle': onSubtleLight,
      '--on-flare': onLight,
      '--chart-1': seedHex,
    },
  };
}

export interface AccentCandidate {
  hex: string;
  /** Higher is a more workable accent: coloured enough to see, mid enough to build a ramp around. */
  score: number;
  /** False for a colour that would make a drab accent, such as a near grey. Offered anyway. */
  usable: boolean;
}

/**
 * Every colour a logo offered, ordered with the most workable accents first.
 *
 * Nothing is dropped for being an unlikely choice. An earlier version filtered out anything too grey
 * or too close to either end of the lightness range, which threw away half of what a customer could
 * see in their own logo, including dark navies and pale golds that are perfectly good brands. The
 * ramp enforces its own contrast, so a dark seed still produces a readable app; what a weak accent
 * costs is character, and that is the customer's call rather than ours. `usable` marks the ones that
 * make a strong accent so a screen can lead with them and mark the rest as muted.
 *
 * Colours a person would call the same are merged, since a logo's anti-aliasing invents dozens of
 * near-duplicates of every edge and offering all of them is the same as offering none. The tolerance
 * is about one and a half times the smallest difference an eye can see in OKLab: wide enough to
 * collapse a fringe, narrow enough to keep two reds a designer picked deliberately.
 */
export function accentCandidates(colors: string[], tolerance = 0.03): AccentCandidate[] {
  const parsed: { hex: string; c: Oklch }[] = [];
  for (const color of colors) {
    try {
      const c = toOklch(color);
      parsed.push({ hex: toHex(c), c });
    } catch {
      continue; // not a colour; the caller's problem, not something to guess at
    }
  }

  // Input order is the caller's idea of prominence, so the first of a cluster wins.
  const kept: { hex: string; c: Oklch }[] = [];
  for (const entry of parsed) {
    if (!kept.some((k) => perceptualDistance(k.c, entry.c) < tolerance)) kept.push(entry);
  }

  return kept
    .map(({ hex, c }) => ({
      hex,
      score: c.c * 2 - Math.abs(c.l - 0.62),
      usable: c.c >= 0.04 && c.l >= 0.25 && c.l <= 0.9,
    }))
    .sort((a, b) => b.score - a.score);
}

/**
 * How far apart two colours look, in OKLab.
 *
 * Euclidean distance in OKLab rather than in RGB: two colours the same distance apart in RGB can be
 * obviously different in one part of the space and indistinguishable in another, which is exactly the
 * mistake that makes a duplicate-merging pass either merge two real brand colours or keep forty
 * shades of the same edge.
 */
function perceptualDistance(a: Oklch, b: Oklch): number {
  const toLab = (c: Oklch) => ({
    l: c.l,
    a: c.c * Math.cos((c.h * Math.PI) / 180),
    b: c.c * Math.sin((c.h * Math.PI) / 180),
  });
  const p = toLab(a);
  const q = toLab(b);
  return Math.hypot(p.l - q.l, p.a - q.a, p.b - q.b);
}

/**
 * The colours from a logo that make a strong accent, most workable first.
 *
 * The strict half of `accentCandidates`, for a caller that wants a recommendation rather than a
 * palette to browse.
 */
export function usableAccents(colors: string[]): string[] {
  return accentCandidates(colors)
    .filter((c) => c.usable)
    .map((c) => c.hex);
}
