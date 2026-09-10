/**
 * A ring: how a total divides up, or how much of an allowance is gone. One figure in the middle,
 * the parts around it, and the names beside it. No pie, because a pie makes the reader compare
 * angles and then puts the labels somewhere else.
 *
 * The arcs are stroked circles rather than wedge paths, which is what makes them sweep: a segment is
 * a dash the length of its share, and growing that dash from nothing is the animation.
 */
import type { ReactNode } from 'react';
import { ink, motion, seriesColor, useIntro } from './style.js';

export interface RingSlice {
  label: string;
  value: number;
  color?: string;
}

interface RingArc {
  slice: RingSlice;
  index: number;
  share: number;
  /** Where this arc starts, as a fraction of the way round. */
  start: number;
  color: string;
}

/** Each slice's share and where it begins, walked once so every arc knows what came before it. */
function ringArcs(parts: RingSlice[], total: number): RingArc[] {
  const arcs: RingArc[] = [];
  let start = 0;
  for (let index = 0; index < parts.length; index += 1) {
    const slice = parts[index];
    if (slice === undefined) continue;
    const share = total === 0 ? 0 : Math.max(0, slice.value) / total;
    arcs.push({ slice, index, share, start, color: slice.color ?? seriesColor(index) });
    start += share;
  }
  return arcs;
}

export function RingStat({
  slices,
  value,
  caption,
  size = 132,
  thickness = 12,
  format,
  otherLabel = 'Other',
  showList = true,
  track,
  emptyLabel = 'Nothing to divide up yet',
}: {
  slices: RingSlice[];
  /** What belongs in the middle: a count, an amount, a percentage. */
  value?: ReactNode;
  caption?: string;
  size?: number;
  thickness?: number;
  format: (value: number) => string;
  otherLabel?: string;
  showList?: boolean;
  /**
   * Draws the unfilled remainder faintly, which is what turns a ring into a gauge. On by default
   * for a single slice, because one arc on its own has nothing to be a share of.
   */
  track?: boolean;
  emptyLabel?: string;
}) {
  const shown = useIntro();

  const ordered = [...slices].sort((a, b) => b.value - a.value);
  // Five colours is the whole palette (docs/18 §3), so a sixth plan joins the others rather than
  // inventing a colour. The frame's table still lists every one of them by name.
  const parts: RingSlice[] =
    ordered.length > 5
      ? [
          ...ordered.slice(0, 4),
          {
            label: otherLabel,
            value: ordered.slice(4).reduce((sum, slice) => sum + slice.value, 0),
          },
        ]
      : ordered;

  const total = parts.reduce((sum, slice) => sum + Math.max(0, slice.value), 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const showTrack = track ?? parts.length <= 1;

  const arcs = ringArcs(parts, total);

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg
          aria-hidden
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          style={{ display: 'block' }}
        >
          <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
            {(showTrack || total === 0) && (
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={ink.baseline}
                strokeWidth={thickness}
              />
            )}
            {total > 0 &&
              arcs.map((arc) => {
                // A hair off the end of each segment, so neighbours read as separate without a gap
                // wide enough to be mistaken for a share of its own.
                const length = Math.max(0, arc.share * circumference - 1.5);
                return (
                  <circle
                    key={arc.slice.label}
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    fill="none"
                    stroke={arc.color}
                    strokeWidth={thickness}
                    strokeDashoffset={-arc.start * circumference}
                    style={{
                      strokeDasharray: shown ? `${length} ${circumference}` : `0 ${circumference}`,
                      transition: `stroke-dasharray ${motion.grow}ms ${motion.ease} ${arc.index * 60}ms`,
                    }}
                  >
                    <title>{`${arc.slice.label}: ${format(arc.slice.value)}`}</title>
                  </circle>
                );
              })}
          </g>
        </svg>

        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5 text-center">
          {total === 0 ? (
            <span className="px-5 text-sm text-faint">{emptyLabel}</span>
          ) : (
            <>
              {value !== undefined && (
                <span className="tnum text-xl leading-none font-semibold tracking-tight">
                  {value}
                </span>
              )}
              {caption !== undefined && <span className="text-sm text-faint">{caption}</span>}
            </>
          )}
        </div>
      </div>

      {showList && total > 0 && (
        <ul className="m-0 min-w-0 flex-1 list-none space-y-1.5 p-0">
          {arcs.map((arc) => (
            <li key={arc.slice.label} className="flex items-baseline gap-2 text-base">
              <span
                aria-hidden
                className="mt-1.5 inline-block size-2 shrink-0 rounded-full"
                style={{ background: arc.color }}
              />
              <span className="min-w-0 flex-1 truncate">{arc.slice.label}</span>
              <span className="tnum shrink-0">{format(arc.slice.value)}</span>
              <span className="tnum w-9 shrink-0 text-right text-sm text-faint">
                {Math.round(arc.share * 100)}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
