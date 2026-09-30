import { placeTooltip } from '@crm/ui/utils';
import { describe, expect, it } from 'vitest';

const viewport = { width: 1440, height: 900 };
const box = (top: number, left: number, width = 120, height = 24) => ({
  top,
  left,
  width,
  height,
  right: left + width,
  bottom: top + height,
});
const tip = { width: 200, height: 28 };

describe('where a tooltip goes', () => {
  it('uses the side asked for when there is room', () => {
    expect(placeTooltip('top', box(400, 600), tip, viewport).side).toBe('top');
  });

  it('flips below an anchor at the top of the window, like the top bar', () => {
    const placed = placeTooltip('top', box(12, 1100), tip, viewport);
    expect(placed.side).toBe('bottom');
    expect(placed.top).toBeGreaterThanOrEqual(12 + 24);
  });

  it('stays inside the right edge for an anchor near it', () => {
    const placed = placeTooltip('bottom', box(12, 1400, 30), tip, viewport);
    expect(placed.left + tip.width).toBeLessThanOrEqual(viewport.width - 4);
  });

  it('flips a right-hand tooltip to the left at the right edge', () => {
    expect(placeTooltip('right', box(400, 1380, 40), tip, viewport).side).toBe('left');
  });
});
