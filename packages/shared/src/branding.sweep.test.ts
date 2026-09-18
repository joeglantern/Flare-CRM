/**
 * Every role, on every background it is drawn on, across a sweep of the colour space.
 *
 * The example-based tests next door check a handful of seeds by hand, and four faults lived through
 * them: a button label chosen against the resting colour alone and unreadable on hover and pressed,
 * a subtle surface derived as a relative step so a black brand produced a mid grey nothing could be
 * read on, pure blue coming back as #0031e5, and white coming back as #fafafa. A customer chooses
 * this colour, so the guarantee has to hold for colours nobody here has looked at.
 */
import { wcagContrast } from 'culori';
import { describe, expect, it } from 'vitest';
import { generateBrandPalette } from './branding.js';

/** A spread of the space, plus the specific colours that used to break. */
const SEEDS: string[] = (() => {
  const out: string[] = [];
  for (let h = 0; h < 360; h += 15) {
    for (const l of [0.14, 0.3, 0.48, 0.64, 0.82, 0.95]) {
      for (const c of [0.03, 0.12, 0.26]) {
        out.push(oklchHex(l, c, h));
      }
    }
  }
  return out.concat([
    '#FF0000',
    '#0000FF',
    '#00FFFF',
    '#FFFF00',
    '#FFFFFF',
    '#000000',
    '#0A0A0A',
    '#1A1A1A',
    '#0B1F3A',
    '#E8590C',
    '#0E9F8F',
    '#E0405A',
    '#777777',
    '#FF6A3D',
  ]);
})();

/** A seed built in OKLCH and rounded through sRGB, so the sweep covers real, reachable colours. */
function oklchHex(l: number, c: number, h: number): string {
  const rad = (h * Math.PI) / 180;
  const a = c * Math.cos(rad);
  const b = c * Math.sin(rad);
  const f = (v: number) => v ** 3;
  const L = f(l + 0.3963377774 * a + 0.2158037573 * b);
  const M = f(l - 0.1055613458 * a - 0.0638541728 * b);
  const S = f(l - 0.0894841775 * a - 1.291485548 * b);
  const lin = [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ];
  const srgb = lin.map((v) => {
    const g = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, g)) * 255);
  });
  return `#${srgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Buttons here are 12 to 13 pixels at weight 500, which is not WCAG large text. */
const TEXT_AA = 4.5;

describe('a generated palette, swept across the colour space', () => {
  it('hands the brand colour back exactly, including the primaries and white', () => {
    const drifted = SEEDS.filter(
      (seed) => generateBrandPalette(seed).accent.toLowerCase() !== seed.toLowerCase(),
    );
    expect(drifted).toEqual([]);
  });

  it('keeps a button label readable at rest, on hover and while pressed, in both themes', () => {
    const failures: string[] = [];
    for (const seed of SEEDS) {
      const palette = generateBrandPalette(seed);
      for (const [theme, tokens] of [
        ['dark', palette.dark],
        ['light', palette.light],
      ] as const) {
        const on = tokens['--on-flare'] ?? '';
        for (const role of ['--flare', '--flare-hover', '--flare-pressed'] as const) {
          const ratio = wcagContrast(tokens[role] ?? '', on);
          if (ratio < TEXT_AA) failures.push(`${seed} ${theme} ${role} ${ratio.toFixed(2)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('keeps the accent text readable on the accent surface, however dark or pale the brand', () => {
    const failures: string[] = [];
    for (const seed of SEEDS) {
      const palette = generateBrandPalette(seed);
      for (const [theme, tokens] of [
        ['dark', palette.dark],
        ['light', palette.light],
      ] as const) {
        const ratio = wcagContrast(
          tokens['--flare-on-subtle'] ?? '',
          tokens['--flare-subtle'] ?? '',
        );
        if (ratio < TEXT_AA) failures.push(`${seed} ${theme} ${ratio.toFixed(2)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('keeps links readable on the page they sit on', () => {
    const failures: string[] = [];
    for (const seed of SEEDS) {
      const palette = generateBrandPalette(seed);
      const dark = wcagContrast(palette.dark['--flare-link'] ?? '', '#000000');
      const light = wcagContrast(palette.light['--flare-link'] ?? '', '#FAFAF8');
      if (dark < TEXT_AA) failures.push(`${seed} dark ${dark.toFixed(2)}`);
      if (light < TEXT_AA) failures.push(`${seed} light ${light.toFixed(2)}`);
    }
    expect(failures).toEqual([]);
  });
});
