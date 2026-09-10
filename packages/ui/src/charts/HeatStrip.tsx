/**
 * One cell per day, thirty or ninety of them in a row. The question it answers is not "how much on
 * the ninth" but "which days were bad", and a row of cells answers that in one sweep of the eye
 * where a line chart of the same numbers would need reading.
 *
 * Intensity carries the measurement and semantic colour carries state, so a day that failed is red
 * because it failed, not because it was a low number.
 */
import { ChartEmpty } from './ChartFrame.js';
import { ink, motion, seriesColor, tickLabel, TYPE, useIntro, useMeasuredWidth } from './style.js';

export interface HeatDay {
  /** ISO date, yyyy-MM-dd. */
  t: string;
  /** Between zero and `max`. Drives how strongly the cell is inked. */
  value: number;
  /** Overrides the intensity ramp where the day is a state rather than an amount. */
  tone?: 'success' | 'warning' | 'danger' | 'empty';
  /** What a hover says about this day. Falls back to the date and the value. */
  label?: string;
}

const TONES = {
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  // A day with no contact at all is a fact, not an absence, so its cell stays a cell rather than
  // fading into the card behind it.
  empty: 'var(--border-strong)',
} as const;

/** Something wrong is drawn at full strength. A run of days where nothing was wrong is not. */
const TONE_OPACITY = { success: 0.72, warning: 1, danger: 1, empty: 1 } as const;

export function HeatStrip({
  days,
  max = 1,
  format,
  color = seriesColor(0),
  height = 24,
  dates = true,
  emptyLabel = 'No days reported yet',
}: {
  days: readonly HeatDay[];
  /** The value a fully inked cell stands for. */
  max?: number;
  format: (value: number) => string;
  color?: string;
  height?: number;
  /** The first and last date under the strip, which is every tick this chart needs. */
  dates?: boolean;
  emptyLabel?: string;
}) {
  const { ref: plotRef, width: measuredWidth } = useMeasuredWidth();
  const shown = useIntro();

  if (days.length === 0) return <ChartEmpty height={height + 14} label={emptyLabel} />;

  const width = Math.max(120, measuredWidth);
  const total = height + (dates ? 14 : 0);
  const gap = days.length > 60 ? 1.5 : 2.5;
  const cell = Math.max(1.5, (width - gap * (days.length - 1)) / days.length);
  // Ninety cells at the stagger a bar chart uses would take two seconds, so the wave is compressed
  // to cross the strip in the time one bar chart takes to grow.
  const stagger = Math.min(motion.stagger, 700 / days.length);

  const first = days[0];
  const last = days[days.length - 1];

  return (
    <div ref={plotRef} className="w-full">
      <svg
        aria-hidden
        width={width}
        height={total}
        viewBox={`0 0 ${width} ${total}`}
        style={{ display: 'block', width: '100%', height: total }}
      >
        {days.map((day, index) => {
          const ratio = max <= 0 ? 0 : Math.min(1, Math.max(0, day.value / max));
          const toned = day.tone !== undefined;
          return (
            <rect
              key={day.t}
              x={index * (cell + gap)}
              y={0}
              width={cell}
              height={height}
              rx={Math.min(2, cell / 2)}
              fill={toned ? TONES[day.tone ?? 'empty'] : color}
              // An unreported day is not a day at nothing, so the floor keeps the cell visible and
              // the ramp above it starts where the reader can tell one day from the next. The top of
              // the ramp stops short of full strength: a month of good days is most of this chart,
              // and at full strength it shouts over everything else on the screen.
              fillOpacity={toned ? TONE_OPACITY[day.tone ?? 'empty'] : 0.14 + ratio * 0.66}
              style={{
                opacity: shown ? 1 : 0,
                transform: shown ? 'none' : 'translateY(3px)',
                transition: `opacity 260ms ${motion.ease} ${index * stagger}ms, transform 260ms ${motion.ease} ${index * stagger}ms`,
              }}
            >
              <title>{day.label ?? `${tickLabel(day.t)}: ${format(day.value)}`}</title>
            </rect>
          );
        })}

        {dates && first !== undefined && last !== undefined && (
          <g fill={ink.context} fontSize={TYPE.tick}>
            <text x={0} y={total - 3}>
              {tickLabel(first.t)}
            </text>
            <text x={width} y={total - 3} textAnchor="end">
              {tickLabel(last.t)}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
