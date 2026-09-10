/**
 * A series at the size of a word: no axes, no labels, no scale, just the shape. It goes next to the
 * figure it belongs to, where its job is to answer "and what has it been doing" in one glance.
 *
 * Scaled to its own minimum and maximum rather than to zero, because a sparkline is about the
 * movement. A flat series sits on its middle, which is the honest drawing of nothing happening.
 */
import { area as d3Area, curveMonotoneX, line as d3Line } from 'd3-shape';
import { AreaGradient, AreaMark, LineMark } from './marks.js';
import {
  dashLength,
  ink,
  seriesColor,
  useChartId,
  useIntro,
  useMeasuredWidth,
  type ChartPoint,
} from './style.js';

export function Sparkline({
  points,
  color = seriesColor(0),
  height = 32,
  width,
  area = true,
  cap = true,
  emptyLabel = 'No samples',
}: {
  points: readonly ChartPoint[];
  color?: string;
  height?: number;
  /** Fixed width, for a sparkline inline in a sentence. Left out, it fills its container. */
  width?: number;
  area?: boolean;
  /** A dot on the most recent point, which is the one the reader is standing on. */
  cap?: boolean;
  emptyLabel?: string;
}) {
  const { ref: plotRef, width: measuredWidth } = useMeasuredWidth(120);
  const shown = useIntro();
  const gradientId = useChartId('spark');
  const plotWidth = Math.max(24, width ?? measuredWidth);

  // Room for the stroke and for the cap dot, so neither is shaved off by the viewBox.
  const padY = 4;
  const padX = cap ? 4 : 1;
  const top = padY;
  const bottom = height - padY;
  const left = padX;
  const right = plotWidth - padX;

  const values = points.map((p) => p.v).filter((v) => Number.isFinite(v));
  const low = Math.min(...values);
  const high = Math.max(...values);
  const flat = values.length === 0 || low === high;
  const y = (value: number) =>
    flat ? (top + bottom) / 2 : bottom - ((value - low) / (high - low)) * (bottom - top);
  const x = (index: number) =>
    points.length <= 1 ? (left + right) / 2 : left + (index / (points.length - 1)) * (right - left);

  const coords: [number, number][] = points.map((p, i) => [x(i), y(p.v)]);
  const last = coords[coords.length - 1];

  const linePath = d3Line()
    .x((c) => c[0])
    .y((c) => c[1])
    .curve(curveMonotoneX)(coords);
  const areaPath = d3Area()
    .x((c) => c[0])
    .y0(bottom)
    .y1((c) => c[1])
    .curve(curveMonotoneX)(coords);

  return (
    <div ref={plotRef} className="w-full">
      <svg
        aria-hidden
        width={plotWidth}
        height={height}
        viewBox={`0 0 ${plotWidth} ${height}`}
        style={{ display: 'block', width: width ?? '100%', height }}
      >
        {points.length === 0 ? (
          <g>
            <line
              x1={left}
              x2={right}
              y1={(top + bottom) / 2}
              y2={(top + bottom) / 2}
              stroke={ink.baseline}
              strokeWidth={1}
              strokeDasharray="3 4"
            />
            <text
              x={(left + right) / 2}
              y={(top + bottom) / 2 - 5}
              textAnchor="middle"
              fontSize={10}
              fill={ink.context}
            >
              {emptyLabel}
            </text>
          </g>
        ) : (
          <>
            {area && (
              <defs>
                <AreaGradient id={gradientId} color={color} />
              </defs>
            )}
            {area && areaPath !== null && (
              <AreaMark d={areaPath} fill={`url(#${gradientId})`} shown={shown} />
            )}
            {linePath !== null && (
              <LineMark
                d={linePath}
                color={color}
                dash={dashLength(coords)}
                shown={shown}
                width={1.75}
              />
            )}
            {cap && last !== undefined && (
              <circle
                cx={last[0]}
                cy={last[1]}
                r={2.5}
                fill={color}
                style={{
                  opacity: shown ? 1 : 0,
                  transition: 'opacity 220ms var(--ease-out) 520ms',
                }}
              />
            )}
          </>
        )}
      </svg>
    </div>
  );
}
