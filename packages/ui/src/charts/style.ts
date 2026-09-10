/**
 * The rules every chart in this kit obeys, in one place (docs/18 §3).
 *
 * These charts are drawn by hand rather than by a chart library, for the same reason the help
 * diagrams are: a library brings its own look, its own DOM and its own colours, and then every
 * chart in the product looks like that library instead of like this product. What we need is
 * small: a scale, a path, and a rule about what we refuse to draw.
 *
 * What we refuse to draw: a border around the plot, a cage of gridlines, and axis lines. A reader
 * learns nothing from a box. They learn from the shape of the series, from a hairline where zero
 * is, from a tick where something happened, and from the number printed at the end of the line.
 * Everything else is ink competing with the data.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';

/**
 * One point on a daily or monthly series. Structurally the `SeriesPoint` the console's API hands
 * back, restated here because the design system must not depend on the product's contracts.
 */
export interface ChartPoint {
  /** ISO date, yyyy-MM-dd. */
  t: string;
  v: number;
}

/** Series colours in a fixed order, so the same thing is the same colour on every screen. */
export const SERIES_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
] as const;

/** Beyond five a reader cannot tell the series apart, so the palette stops there (docs/18 §3). */
export const MAX_SERIES = SERIES_COLORS.length;

export function seriesColor(index: number): string {
  return SERIES_COLORS[index % MAX_SERIES] ?? SERIES_COLORS[0];
}

/**
 * The kinds of ink a chart is allowed to use. `context` is for anything that is not the data
 * itself: a cap rule, a projection, a tick label. Semantic colour stays reserved for state, so a
 * series never turns red merely because it went down.
 */
export const ink = {
  /** The one line we do draw: where zero is, or where the bars stand. */
  baseline: 'var(--border)',
  /** Cap rules, projections, tick labels: the axis that is not there. */
  context: 'var(--text-faint)',
  /** A figure printed on the plot, such as the value at the end of a series. */
  value: 'var(--text-muted)',
  /** Behind a readout, so it stays legible over a line. */
  backdrop: 'var(--surface)',
} as const;

/**
 * Motion, in milliseconds. A chart animating tells the reader it has just been computed, which is
 * true; animating for longer than this tells them to wait, which is rude. Someone who has asked
 * for less movement gets the final frame and none of this.
 */
export const motion = {
  /** A line draws itself on from left to right. */
  draw: 700,
  /** The area under it rises into place behind the line. */
  rise: 520,
  /** A bar grows out of the baseline. */
  grow: 420,
  /** And the next bar starts a breath later, so a row of them reads left to right. */
  stagger: 25,
  /** A headline figure counts up to itself. */
  count: 600,
  ease: 'var(--ease-out)',
} as const;

/** How far an area lifts as it fades in, in pixels. */
export const RISE_PX = 6;

/** The opacity of an area at the top of its gradient; it reaches zero at the baseline. */
export const AREA_OPACITY = 0.18;

export interface Inset {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

function queryReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * True while the user has asked their system for less movement. Read live, because someone can
 * change it without reloading the page.
 */
export function usePrefersReducedMotion(): boolean {
  // Read while rendering rather than in an effect, so the first paint already knows the answer and
  // a chart under reduced motion is never briefly animated before being told not to be.
  const [reduced, setReduced] = useState(queryReducedMotion);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => {
      setReduced(query.matches);
    };
    query.addEventListener('change', onChange);
    return () => {
      query.removeEventListener('change', onChange);
    };
  }, []);
  return reduced;
}

/**
 * False on the first paint and true on the next, which is what an inline CSS transition needs in
 * order to have somewhere to move from. Two frames rather than one: a style set in the same frame
 * as the element's first paint is folded into that paint, and nothing animates.
 *
 * Under reduced motion this is true from the first render, so the chart is simply already finished.
 */
export function useIntro(): boolean {
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(false);
  const animatable = !reduced && typeof requestAnimationFrame === 'function';

  useEffect(() => {
    if (!animatable) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        setShown(true);
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [animatable]);

  // Somewhere with no frames to wait for, such as a server or a test, the chart is simply finished.
  return !animatable || shown;
}

/**
 * Approximates var(--ease-out), cubic-bezier(0.16, 1, 0.3, 1), for the one animation that cannot
 * be a CSS transition because it changes text rather than geometry. Solving the real curve per
 * frame would be more faithful than the eye can tell across 600ms.
 */
function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 5);
}

/**
 * Counts from the figure last shown to this one. On first render it counts up from zero, which is
 * the only animation in this kit the reader is meant to notice.
 */
export function useCountUp(value: number, duration: number = motion.count): number {
  const reduced = usePrefersReducedMotion();
  const animatable = !reduced && typeof requestAnimationFrame === 'function';
  const [shown, setShown] = useState(0);
  /** Where the next run starts: the last figure this hook settled on, or was interrupted at. */
  const from = useRef(0);

  useEffect(() => {
    if (!animatable) return;
    const start = from.current;
    if (start === value) return;
    let frame = 0;
    let began: number | null = null;
    let reached = start;
    const step = (now: number) => {
      began ??= now;
      const t = Math.min(1, (now - began) / duration);
      reached = start + (value - start) * easeOut(t);
      setShown(reached);
      if (t < 1) {
        frame = requestAnimationFrame(step);
        return;
      }
      from.current = value;
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      // An interrupted count carries on from where it stopped rather than jumping back to nothing.
      from.current = reached;
    };
  }, [value, duration, animatable]);

  return animatable ? shown : value;
}

/**
 * The plot's width in real pixels, so text is set at a readable size and a hairline is one pixel
 * rather than whatever a scaled viewBox made of it. Falls back to a sensible desktop width where
 * there is nothing to measure with, which keeps the charts renderable under a test DOM.
 */
export function useMeasuredWidth(fallback = 560): MeasuredWidth {
  const [width, setWidth] = useState(fallback);

  // A ref callback rather than a ref object and an effect: React hands the node straight to this,
  // and the observer it sets up is torn down by the function it returns, so nothing has to be
  // stored between renders and no chart reads a ref while it is drawing itself.
  const ref = useCallback((node: HTMLDivElement | null) => {
    if (node === null) return;
    const read = () => {
      const measured = node.clientWidth;
      if (measured > 0) setWidth(measured);
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, []);

  return { ref, width };
}

export interface MeasuredWidth {
  /** Put on the element whose width the chart should fill. */
  ref: (node: HTMLDivElement | null) => (() => void) | undefined;
  width: number;
}

/** A DOM id unique to one instance of a chart, for the gradients and labels it owns. */
export function useChartId(prefix: string): string {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  return `${prefix}-${id}`;
}

/**
 * An upper bound on how long a path is, used as the dash that the draw-on animation pays out.
 * Measured from the points rather than with `getTotalLength`, so it is known before the browser
 * has laid anything out and is the same number in a test as in a browser.
 *
 * A generous bound is harmless: the dash only has to be at least as long as the path, or the line
 * would show a gap once it settles.
 */
export function dashLength(coords: readonly (readonly [number, number])[]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i += 1) {
    const a = coords[i - 1];
    const b = coords[i];
    if (a === undefined || b === undefined) continue;
    total += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  // A curve through the points is longer than the straight lines between them, never by half.
  return Math.max(1, total * 1.5);
}

/**
 * A round number at or above the largest value, so the top of the plot is a figure a person would
 * say out loud. A series that is empty or flat at zero gets a domain of 1, because a plot from 0
 * to 0 has no height to draw in.
 */
export function niceMax(values: readonly number[], atLeast = 0): number {
  const finite = values.filter((v) => Number.isFinite(v));
  const peak = Math.max(atLeast, 0, ...finite);
  if (peak <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(peak)));
  for (const step of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    const candidate = step * magnitude;
    if (candidate >= peak) return candidate;
  }
  return 10 * magnitude;
}

/**
 * Which points along a series get a label underneath. The ends always do, because the reader needs
 * to know what range they are looking at; the middle gets labels only while they fit, and never so
 * many that the axis becomes a sentence.
 */
export function tickIndexes(count: number, width: number, perLabel = 86): number[] {
  if (count <= 0) return [];
  if (count === 1) return [0];
  const room = Math.max(2, Math.min(5, Math.floor(width / perLabel)));
  if (count <= room) return Array.from({ length: count }, (_, i) => i);
  const step = (count - 1) / (room - 1);
  const picked = new Set<number>([0, count - 1]);
  for (let i = 0; i < room; i += 1) picked.add(Math.round(i * step));
  return [...picked].sort((a, b) => a - b);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Dates on a chart are read in UTC, the same way the server rolled the day up. Reading them in the
 * browser's zone would slide a day's figure onto the day before it for anyone west of London.
 */
function utc(iso: string): Date | null {
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `5 Sep`, the only date format small enough to sit under a tick. */
export function tickLabel(iso: string): string {
  const date = utc(iso);
  if (date === null) return iso;
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()] ?? ''}`;
}

/** `Sep 26`, for a series of months where the day would be noise. */
export function monthLabel(iso: string): string {
  const date = utc(iso);
  if (date === null) return iso;
  return `${MONTHS[date.getUTCMonth()] ?? ''} ${String(date.getUTCFullYear()).slice(2)}`;
}

/** `5 September`, for a readout that has room to be unambiguous. */
export function longDateLabel(iso: string): string {
  const date = utc(iso);
  if (date === null) return iso;
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()] ?? ''} ${date.getUTCFullYear()}`;
}

/** The size a chart's own labels are set at, in pixels, at any chart width. */
export const TYPE = { tick: 10, value: 11, readout: 11 } as const;

/**
 * Roughly how wide a string will be at one of those sizes. Close enough to reserve room for a
 * label or decide which side of the cursor a readout goes on, and it costs no layout to find out,
 * which matters because the answer is needed while deciding what to draw.
 */
export function textWidth(text: string, size: number = TYPE.readout): number {
  return text.length * size * 0.56;
}
