import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Tailwind class merge helper used by every component. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function assertNever(value: never): never {
  throw new Error(`Unhandled case: ${String(value)}`);
}

// ── tooltip placement ───────────────────────────────────────────────────────────────────────

export type TooltipSide = 'top' | 'right' | 'bottom' | 'left';
type Side = TooltipSide;

const GAP = 8;
/** Keeps a tooltip this far from the window's edge. */
const MARGIN = 4;

const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

interface Size {
  width: number;
  height: number;
}
interface Box {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}
interface Viewport {
  width: number;
  height: number;
}

/** Whether a tooltip of this size fits on this side of the anchor. */
function fits(side: Side, a: Box, t: Size, v: Viewport): boolean {
  switch (side) {
    case 'top':
      return a.top - GAP - t.height >= MARGIN;
    case 'bottom':
      return a.bottom + GAP + t.height <= v.height - MARGIN;
    case 'left':
      return a.left - GAP - t.width >= MARGIN;
    case 'right':
      return a.right + GAP + t.width <= v.width - MARGIN;
  }
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

/**
 * Where the tooltip goes: the preferred side if it fits, else the opposite one if that fits, else
 * the preferred side anyway; then pulled back inside the window along both axes.
 */
export function placeTooltip(
  preferred: Side,
  a: Box,
  t: Size,
  v: Viewport,
): { top: number; left: number; side: Side } {
  const side =
    fits(preferred, a, t, v) || !fits(OPPOSITE[preferred], a, t, v)
      ? preferred
      : OPPOSITE[preferred];
  let top: number;
  let left: number;
  if (side === 'top' || side === 'bottom') {
    top = side === 'top' ? a.top - GAP - t.height : a.bottom + GAP;
    left = a.left + a.width / 2 - t.width / 2;
  } else {
    top = a.top + a.height / 2 - t.height / 2;
    left = side === 'left' ? a.left - GAP - t.width : a.right + GAP;
  }
  return {
    side,
    top: clamp(top, MARGIN, v.height - t.height - MARGIN),
    left: clamp(left, MARGIN, v.width - t.width - MARGIN),
  };
}
