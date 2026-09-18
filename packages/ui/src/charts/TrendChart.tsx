/**
 * A series over time: an area under a line, a hairline where zero is, a tick where the reader needs
 * to know the date, the figure printed at the end, and nothing else.
 *
 * It can be inspected three ways, all of which move the same cursor. Hovering reads the day under
 * the pointer. Tabbing to the plot and using the arrow keys walks the series a day at a time, which
 * is the only way to do it without a mouse and is announced as it goes. And the figures themselves
 * are in the table the frame keeps for a screen reader, so nobody has to operate a cursor at all.
 */
import { area as d3Area, curveMonotoneX, line as d3Line } from 'd3-shape';
import { useState } from 'react';
import { ChartEmpty } from './ChartFrame.js';
import { AreaGradient, AreaMark, Baseline, ContextRule, LineMark } from './marks.js';
import {
  dashLength,
  ink,
  longDateLabel,
  MAX_SERIES,
  monthLabel,
  motion,
  niceMax,
  seriesColor,
  tickIndexes,
  textWidth,
  tickLabel,
  TYPE,
  useChartId,
  useIntro,
  useMeasuredWidth,
  type ChartPoint,
} from './style.js';

export interface TrendSeries {
  key: string;
  label: string;
  points: readonly ChartPoint[];
  color?: string;
  /**
   * Drawn dashed and without an area: what was sold, read against what is used. A dashed series is
   * an allowance rather than a measurement, so it gets the lighter treatment.
   */
  dashed?: boolean;
  /** Solid series fill by default; turn it off where two filled areas would muddy each other. */
  area?: boolean;
}

export function TrendChart({
  series,
  height = 160,
  format,
  cap,
  granularity = 'day',
  baseline = 'zero',
  inspectLabel = 'Inspect the series',
  emptyLabel = 'No samples yet',
  endValues = true,
}: {
  series: TrendSeries[];
  height?: number;
  /** How a value is said: seats, bytes, money. Used for the readout and the end figures. */
  format: (value: number) => string;
  /** A ceiling the series is read against, drawn as a dashed rule. */
  cap?: { value: number; label: string } | null;
  granularity?: 'day' | 'month';
  /**
   * `zero` starts the plot at nothing, which is how a count or an amount should be read. `fit`
   * starts it just under the lowest point, for a series like uptime that lives near its ceiling.
   */
  baseline?: 'zero' | 'fit';
  inspectLabel?: string;
  emptyLabel?: string;
  endValues?: boolean;
}) {
  const { ref: plotRef, width: measuredWidth } = useMeasuredWidth();
  const shown = useIntro();
  const gradientId = useChartId('trend');
  const [cursor, setCursor] = useState<number | null>(null);

  const drawn = series.slice(0, MAX_SERIES).filter((s) => s.points.length > 0);
  const count = Math.max(0, ...drawn.map((s) => s.points.length));
  const dates = drawn.find((s) => s.points.length === count)?.points ?? [];

  if (count === 0) return <ChartEmpty height={height} label={emptyLabel} />;

  const width = Math.max(160, measuredWidth);
  const labelDate = granularity === 'month' ? monthLabel : tickLabel;

  /**
   * A price axis on the right, which is how every trading chart is read: the series runs to the edge
   * of the plot and its last figure sits outside it, so the figure never covers the data it belongs
   * to and the eye always knows where to look for the current number. Wide enough for the widest
   * figure and no wider, capped so one enormous number cannot eat the plot.
   */
  const endTexts = endValues ? drawn.map((s) => format(s.points[s.points.length - 1]?.v ?? 0)) : [];
  const gutter =
    endTexts.length === 0
      ? 0
      : Math.min(96, Math.max(...endTexts.map((t) => textWidth(t, TYPE.value))) + 16);

  // No axis lines and no cage, so the rest of the insets are only what the ink itself needs: a
  // tick label's line underneath, and a little headroom.
  const inset = { top: 10, right: 3 + gutter, bottom: 18, left: 1 };
  const top = inset.top;
  const bottom = height - inset.bottom;
  const left = inset.left;
  const right = width - inset.right;

  const allValues = drawn.flatMap((s) => s.points.map((p) => p.v));
  const high = niceMax(allValues, cap?.value ?? 0);
  const low =
    baseline === 'fit' && allValues.length > 0
      ? Math.min(...allValues) * 0.98
      : Math.min(0, ...allValues);

  const y = (value: number) =>
    high === low ? bottom : bottom - ((value - low) / (high - low)) * (bottom - top);
  const x = (index: number) =>
    count <= 1 ? (left + right) / 2 : left + (index / (count - 1)) * (right - left);

  const ticks = tickIndexes(count, width);
  const at = cursor === null ? null : Math.min(count - 1, Math.max(0, cursor));

  const readings = drawn.map((s) => {
    const point = at === null ? undefined : s.points[at];
    return { series: s, point };
  });

  const unit = granularity === 'month' ? 'month' : 'day';
  const cursorText =
    at === null
      ? `${count} ${count === 1 ? unit : `${unit}s`} to ${labelDate(dates[count - 1]?.t ?? '')}`
      : [
          longDateLabel(dates[at]?.t ?? ''),
          ...readings.map((r) =>
            r.point === undefined ? '' : `${r.series.label} ${format(r.point.v)}`,
          ),
        ]
          .filter((line) => line !== '')
          .join(', ');

  const step = (delta: number) => {
    setCursor((current) => {
      const from = current ?? count - 1;
      return Math.min(count - 1, Math.max(0, from + delta));
    });
  };

  return (
    <div ref={plotRef} className="relative w-full">
      <svg
        aria-hidden
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ display: 'block', width: '100%', height }}
      >
        <defs>
          {drawn.map((s, index) => (
            <AreaGradient
              key={s.key}
              id={`${gradientId}-${index}`}
              color={s.color ?? seriesColor(index)}
            />
          ))}
        </defs>

        {/*
          Two levels, drawn under everything and barely there: enough to judge a height against, far
          too faint to compete with the series. This is the whole of the grid. A cage of verticals as
          well would tell a reader nothing the tick labels do not already say.
        */}
        <ValueRules
          levels={[high, low + (high - low) / 2]}
          x1={left}
          x2={right}
          gutterX={right + 6}
          y={y}
          format={format}
          shown={shown}
        />

        <Baseline x1={left} x2={right} y={bottom} />

        {/* Labelled at the left end: the right end is where the series prints its own last figure,
            and a series close to its cap would print the two on top of each other. */}
        {cap != null && cap.value <= high && (
          <ContextRule x1={left} x2={right} y={y(cap.value)} label={cap.label} align="start" />
        )}

        {drawn.map((s, index) => {
          const color = s.color ?? seriesColor(index);
          const coords: [number, number][] = s.points.map((p, i) => [x(i), y(p.v)]);
          const filled = s.area ?? s.dashed !== true;
          const linePath = d3Line()
            .x((c) => c[0])
            .y((c) => c[1])
            .curve(curveMonotoneX)(coords);
          const areaPath = d3Area()
            .x((c) => c[0])
            .y0(bottom)
            .y1((c) => c[1])
            .curve(curveMonotoneX)(coords);
          const only = coords.length === 1 ? coords[0] : undefined;
          return (
            <g key={s.key}>
              {filled && areaPath !== null && coords.length > 1 && (
                <AreaMark
                  d={areaPath}
                  fill={`url(#${gradientId}-${index})`}
                  shown={shown}
                  delay={index * 60}
                />
              )}
              {linePath !== null && coords.length > 1 && (
                <LineMark
                  d={linePath}
                  color={color}
                  dash={dashLength(coords)}
                  shown={shown}
                  dashed={s.dashed === true}
                  delay={index * 60}
                />
              )}
              {/* The head of the series. A trading chart marks where the line has got to and
                  nowhere else; a dot on every sample is upholstery. */}
              {coords.length > 1 && s.dashed !== true && (
                <circle
                  cx={coords[coords.length - 1]?.[0] ?? 0}
                  cy={coords[coords.length - 1]?.[1] ?? 0}
                  r={2.5}
                  fill={color}
                  style={{
                    opacity: shown ? 1 : 0,
                    transition: `opacity ${motion.rise}ms ${motion.ease} ${motion.draw - 120}ms`,
                  }}
                />
              )}
              {/* One sample is not a line. It is a point, and drawing it as one says so. */}
              {only !== undefined && (
                <circle
                  cx={only[0]}
                  cy={only[1]}
                  r={3}
                  fill={color}
                  style={{
                    opacity: shown ? 1 : 0,
                    transition: `opacity ${motion.rise}ms ${motion.ease}`,
                  }}
                />
              )}
            </g>
          );
        })}

        {endValues && (
          <EndValues entries={endLabelPositions(drawn, y, format)} x={right + 6} shown={shown} />
        )}

        {ticks.map((index) => {
          const point = dates[index];
          if (point === undefined) return null;
          const anchor = index === 0 ? 'start' : index === count - 1 ? 'end' : 'middle';
          return (
            <text
              key={point.t}
              x={x(index)}
              y={height - 5}
              textAnchor={anchor}
              fontSize={TYPE.tick}
              fill={ink.context}
            >
              {labelDate(point.t)}
            </text>
          );
        })}

        {at !== null && (
          <g>
            <line
              x1={x(at)}
              x2={x(at)}
              y1={top - 6}
              y2={bottom}
              stroke={ink.context}
              strokeWidth={1}
              strokeDasharray="2 3"
            />
            {/*
              The other half of the crosshair, and the reason a crosshair is worth having: the level
              the cursor is at, carried out to the axis and printed there. A vertical line alone says
              which day; this says how much, without the reader measuring against anything.
            */}
            {readings[0]?.point !== undefined && (
              <>
                <line
                  x1={left}
                  x2={right}
                  y1={y(readings[0].point.v)}
                  y2={y(readings[0].point.v)}
                  stroke={ink.context}
                  strokeWidth={1}
                  strokeDasharray="2 3"
                />
                <AxisPill
                  x={right + 6}
                  y={y(readings[0].point.v)}
                  text={format(readings[0].point.v)}
                  color={readings[0].series.color ?? seriesColor(0)}
                  solid
                />
              </>
            )}
            {readings.map((r, index) =>
              r.point === undefined ? null : (
                <circle
                  key={r.series.key}
                  cx={x(at)}
                  cy={y(r.point.v)}
                  r={3.5}
                  fill={ink.backdrop}
                  stroke={r.series.color ?? seriesColor(index)}
                  strokeWidth={2}
                />
              ),
            )}
            <Readout
              x={x(at)}
              plotLeft={left}
              plotRight={right}
              top={top}
              date={labelDate(dates[at]?.t ?? '')}
              lines={readings.map((r, index) => ({
                label: r.series.label,
                value: r.point === undefined ? '—' : format(r.point.v),
                color: r.series.color ?? seriesColor(index),
              }))}
            />
          </g>
        )}
      </svg>

      {/*
        The cursor is a slider because that is what it is: one position along an ordered range,
        moved with the arrow keys, announcing the value it lands on. Pointer and keyboard then drive
        the same state instead of the chart growing two ways to be read.
      */}
      <div
        role="slider"
        tabIndex={0}
        aria-label={inspectLabel}
        aria-valuemin={0}
        aria-valuemax={count - 1}
        aria-valuenow={at ?? count - 1}
        aria-valuetext={cursorText}
        className="absolute inset-0 cursor-crosshair rounded-sm"
        style={{ bottom: inset.bottom }}
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          if (rect.width === 0) return;
          const ratio = (event.clientX - rect.left - left) / Math.max(1, right - left);
          setCursor(Math.round(ratio * (count - 1)));
        }}
        onPointerLeave={() => {
          setCursor(null);
        }}
        onFocus={() => {
          setCursor((current) => current ?? count - 1);
        }}
        onBlur={() => {
          setCursor(null);
        }}
        onKeyDown={(event) => {
          const keys: Record<string, () => void> = {
            ArrowLeft: () => {
              step(-1);
            },
            ArrowRight: () => {
              step(1);
            },
            ArrowDown: () => {
              step(-1);
            },
            ArrowUp: () => {
              step(1);
            },
            Home: () => {
              setCursor(0);
            },
            End: () => {
              setCursor(count - 1);
            },
            Escape: () => {
              setCursor(null);
            },
          };
          const handler = keys[event.key];
          if (handler === undefined) return;
          event.preventDefault();
          handler();
        }}
      />
    </div>
  );
}

interface EndLabel {
  key: string;
  text: string;
  color: string;
  y: number;
}

/**
 * The last figure of each series, printed where the series ends. Two series that finish close
 * together would print over each other, so the labels are pushed apart just enough to be read,
 * keeping the order they are stacked in.
 */
function endLabelPositions(
  drawn: TrendSeries[],
  y: (value: number) => number,
  format: (value: number) => string,
): EndLabel[] {
  const labels = drawn
    .map((s, index) => {
      const last = s.points[s.points.length - 1];
      if (last === undefined) return null;
      return {
        key: s.key,
        text: format(last.v),
        color: s.color ?? seriesColor(index),
        // The centre of the pill, which is the height the series actually finished at.
        y: y(last.v),
      };
    })
    .filter((label): label is EndLabel => label !== null)
    .sort((a, b) => a.y - b.y);

  for (let i = 1; i < labels.length; i += 1) {
    const previous = labels[i - 1];
    const current = labels[i];
    if (previous === undefined || current === undefined) continue;
    const overlap = previous.y + 15 - current.y;
    if (overlap > 0) current.y += overlap;
  }
  return labels;
}

function EndValues({ entries, x, shown }: { entries: EndLabel[]; x: number; shown: boolean }) {
  return (
    <g
      style={{
        opacity: shown ? 1 : 0,
        transition: `opacity ${motion.rise}ms ${motion.ease} ${motion.draw - 180}ms`,
      }}
    >
      {entries.map((entry) => (
        <AxisPill key={entry.key} x={x} y={entry.y} text={entry.text} color={entry.color} />
      ))}
    </g>
  );
}

/**
 * A figure on the price axis, in the colour of the series it belongs to.
 *
 * Tinted and outlined rather than filled solid, because the fill would have to carry text and a
 * series colour is whatever the customer's brand turned out to be: there is no colour to write on
 * it that is guaranteed to be readable. A tint of the series colour behind its own text is legible
 * against either theme whatever the hue, which a guessed black or white is not. `solid` deepens it
 * for the one pill that is following the cursor, so it reads as the live figure among the settled
 * ones.
 */
function AxisPill({
  x,
  y,
  text,
  color,
  solid = false,
}: {
  x: number;
  y: number;
  text: string;
  color: string;
  solid?: boolean;
}) {
  const w = textWidth(text, TYPE.value) + 10;
  const h = 15;
  return (
    <g pointerEvents="none">
      <rect
        x={x}
        y={y - h / 2}
        width={w}
        height={h}
        rx={3}
        fill={color}
        fillOpacity={solid ? 0.26 : 0.14}
        stroke={color}
        strokeOpacity={solid ? 1 : 0.55}
        strokeWidth={1}
      />
      <text
        x={x + w / 2}
        y={y + 3.5}
        textAnchor="middle"
        fontSize={TYPE.value}
        fontWeight={600}
        fill={color}
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {text}
      </text>
    </g>
  );
}

/**
 * The levels a height is judged against, and their figures on the axis.
 *
 * Drawn first so the series covers them, and faint enough that they are found only when looked for.
 * A level equal to the baseline is skipped: the baseline is already there and drawing both puts two
 * lines in the same place.
 */
function ValueRules({
  levels,
  x1,
  x2,
  gutterX,
  y,
  format,
  shown,
}: {
  levels: number[];
  x1: number;
  x2: number;
  gutterX: number;
  y: (value: number) => number;
  format: (value: number) => string;
  shown: boolean;
}) {
  return (
    <g
      pointerEvents="none"
      style={{
        opacity: shown ? 1 : 0,
        transition: `opacity ${motion.rise}ms ${motion.ease}`,
      }}
    >
      {levels.map((value) => (
        <g key={value}>
          <line
            x1={x1}
            x2={x2}
            y1={y(value)}
            y2={y(value)}
            stroke={ink.baseline}
            strokeOpacity={0.45}
            strokeWidth={1}
          />
          <text
            x={gutterX}
            y={y(value) + 3.5}
            fontSize={TYPE.tick}
            fill={ink.context}
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {format(value)}
          </text>
        </g>
      ))}
    </g>
  );
}

/**
 * The compact readout that follows the cursor: the date, then one line per series. It flips to the
 * other side of the cursor rather than running off the plot.
 */
function Readout({
  x,
  plotLeft,
  plotRight,
  top,
  date,
  lines,
}: {
  x: number;
  plotLeft: number;
  plotRight: number;
  top: number;
  date: string;
  lines: { label: string; value: string; color: string }[];
}) {
  const rows = [date, ...lines.map((l) => `${l.label} ${l.value}`)];
  const width = Math.max(...rows.map((row) => textWidth(row))) + 20;
  const height = 14 + rows.length * 14;
  const flip = x + 12 + width > plotRight;
  const boxX = Math.max(plotLeft, flip ? x - 12 - width : x + 12);
  const boxY = Math.max(0, top - 10);

  return (
    <g pointerEvents="none">
      <rect
        x={boxX}
        y={boxY}
        width={width}
        height={height}
        rx={6}
        fill={ink.backdrop}
        stroke={ink.baseline}
        strokeWidth={1}
        opacity={0.98}
      />
      <text
        x={boxX + 8}
        y={boxY + 16}
        fontSize={TYPE.readout}
        fill={ink.context}
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {date}
      </text>
      {lines.map((line, index) => (
        <text
          key={line.label}
          x={boxX + 8}
          y={boxY + 30 + index * 14}
          fontSize={TYPE.readout}
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          <tspan fill={line.color}>{line.label} </tspan>
          <tspan fill="var(--text)" fontWeight={500}>
            {line.value}
          </tspan>
        </text>
      ))}
    </g>
  );
}
