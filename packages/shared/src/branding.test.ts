/**
 * The point of generating a palette rather than storing one is that it has to hold for a colour
 * nobody has seen yet. These check the properties that must be true for any of them.
 */
import { wcagContrast } from 'culori';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ACCENT, generateBrandPalette, usableAccents, brandPalette } from './branding.js';

/** A spread wide enough that a recipe tuned to orange cannot quietly be the only one that works. */
const SEEDS = [
  DEFAULT_ACCENT,
  '#2F6FD6', // blue
  '#1E9E5E', // green
  '#B7791F', // ochre
  '#C8322B', // red
  '#7A3DF5', // violet
  '#F5E03D', // yellow, the awkward one: light and hard to read on paper
];

describe('a palette generated from one colour', () => {
  it('keeps the brand colour exactly as given', () => {
    for (const seed of SEEDS) {
      const palette = generateBrandPalette(seed);
      expect(palette.dark['--flare']?.toLowerCase()).toBe(seed.toLowerCase());
      expect(palette.light['--flare']?.toLowerCase()).toBe(seed.toLowerCase());
    }
  });

  it('is a valid token set for both themes', () => {
    for (const seed of SEEDS) {
      expect(brandPalette.safeParse(generateBrandPalette(seed)).success).toBe(true);
    }
  });

  it('gives every theme the roles the stylesheet asks for', () => {
    const palette = generateBrandPalette('#2F6FD6');
    for (const theme of [palette.dark, palette.light]) {
      for (const role of [
        '--flare',
        '--flare-hover',
        '--flare-pressed',
        '--flare-link',
        '--flare-subtle',
        '--flare-on-subtle',
        '--on-flare',
        '--flare-500',
      ]) {
        expect(theme[role], `${role} missing`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  /** The check that matters: a customer's logo must not be able to produce an unreadable app. */
  it('keeps links readable on both backgrounds, whatever the seed', () => {
    for (const seed of SEEDS) {
      const palette = generateBrandPalette(seed);
      expect(
        wcagContrast(palette.dark['--flare-link'] ?? '', '#000000'),
        seed,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        wcagContrast(palette.light['--flare-link'] ?? '', '#FAFAF8'),
        seed,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps text readable on the subtle surface it sits on', () => {
    for (const seed of SEEDS) {
      const palette = generateBrandPalette(seed);
      expect(
        wcagContrast(palette.dark['--flare-on-subtle'] ?? '', palette.dark['--flare-subtle'] ?? ''),
        seed,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        wcagContrast(
          palette.light['--flare-on-subtle'] ?? '',
          palette.light['--flare-subtle'] ?? '',
        ),
        seed,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('picks a button foreground that can be read on the button', () => {
    for (const seed of SEEDS) {
      const palette = generateBrandPalette(seed);
      // 3:1 is the floor for the large, bold text a button carries; most seeds clear 4.5 anyway.
      expect(
        wcagContrast(palette.dark['--on-flare'] ?? '', palette.dark['--flare'] ?? ''),
        seed,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it('runs the ramp from light to dark without doubling back', () => {
    const palette = generateBrandPalette('#1E9E5E');
    const order = [
      '--flare-100',
      '--flare-300',
      '--flare-400',
      '--flare-500',
      '--flare-600',
      '--flare-700',
      '--flare-950',
    ];
    const lightness = order.map((k) => wcagContrast(palette.dark[k] ?? '', '#000000'));
    for (let i = 1; i < lightness.length; i++) {
      expect(lightness[i]!, `${order[i]} should be darker than ${order[i - 1]}`).toBeLessThan(
        lightness[i - 1]!,
      );
    }
  });
});

describe('choosing an accent out of a logo', () => {
  it('drops what cannot serve as one', () => {
    const offered = usableAccents(['#FFFFFF', '#000000', '#F7F7F5', '#8A8985', '#2F6FD6']);
    expect(offered).toEqual(['#2f6fd6']);
  });

  it('prefers the colour that will read best over the merely loudest', () => {
    const [first] = usableAccents(['#1B0D33', '#7A3DF5']);
    expect(first).toBe('#7a3df5');
  });

  it('says nothing rather than guessing, for a logo with no colour in it', () => {
    expect(usableAccents(['#FFFFFF', '#111111', '#9A9893'])).toEqual([]);
  });
});
