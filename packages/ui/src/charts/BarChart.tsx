/**
 * Bars, standing on a hairline or lying against one. Vertical when the categories are a sequence
 * and horizontal when they are a list with names long enough to need a column of their own, which
 * is most lists: a version string or a plan name turned on its side is a chart nobody reads.
 *
 * Grouped puts a bar per series side by side, for comparing them. Stacked puts them end to end, for
 * a total made of parts. There is no third option, because a bar chart that is neither is a trap.
 */
import { scaleBand, scaleLinear } from 'd3-scale';
import { ChartEmpty } from './ChartFrame.js';
import {
  ink,
  MAX_SERIES,
  motion,
  niceMax,
  seriesColor,
  textWidth,
  TYPE,
  useIntro,
  useMeasuredWidth,
} from './style.js';

export interface BarSeries {
  key: string;
  label: string;
  /** One value per category, in the order the categories are given. */
  values: readonly number[];
  color?: string;
}

/**
 * A bar with the end it grows towards rounded and the end on the baseline square, so it reads as
 * standing on the line rather than floating above it.
 */
function barPath(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  round: 'top' | 'right' | 'none',
): string {
  if (width <= 0 || height <= 0) return '';
  if (round === 'none') return `M${x},${y}h${width}v${height}h${-width}Z`;
  if (round === 'top') {
    const r = Math.min(radius, width / 2, height);
    return [
      `M${x},${y + height}`,
      `L${x},${y + r}`,
      `Q${x},${y} ${x + r},${y}`,
      `L${x + width - r},${y}`,
      `Q${x + width},${y} ${x + width},${y + r}`,
      `L${x + width},${y + height}`,
      'Z',
    ].join('');
  }
  const r = Math.min(radius, height / 2, width);
  return [
    `M${x},${y}`,
    `L${x + width - r},${y}`,
    `Q${x + width},${y} ${x + width},${y + r}`,
    `L${x + width},${y + height - r}`,
    `Q${x + width},${y + height} ${x + width - r},${y + height}`,
    `L${x},${y + height}`,
    'Z',
  ].join('');
}

export function BarChart({
  categories,
  series,
  orientation = 'vertical',
  stacked = false,
  format,
  height,
  rowHeight = 26,
  valueLabels,
  emptyLabel = 'Nothing to count yet',
}: {
  categories: string[];
  series: BarSeries[];
  orientation?: 'vertical' | 'horizontal';
  stacked?: boolean;
  format: (value: number) => string;
  /** Vertical only; a horizontal chart is as tall as its rows make it. */
  height?: number;
  /** Horizontal only: how tall one category's row is. */
  rowHeight?: number;
  /**
   * Printing a figure on every bar of a grouped chart is clutter, so by default only charts where
   * there is one figure per category print one. The rest carry their numbers in the frame's table.
   */
  valueLabels?: boolean;
  emptyLabel?: string;
}) {
  const { ref: plotRef, width: measuredWidth } = useMeasuredWidth();
  const shown = useIntro();

  const drawn = series.slice(0, MAX_SERIES);
  const labels = valueLabels ?? (drawn.length === 1 || stacked);
  if (categories.length === 0 || drawn.length === 0) {
    return <ChartEmpty height={height ?? rowHeight * 3} label={emptyLabel} />;
  }

  const width = Math.max(160, measuredWidth);
  const totals = categories.map((_, index) =>
    drawn.reduce((sum, s) => sum + (s.values[index] ?? 0), 0),
  );
  const peak = stacked ? totals : drawn.flatMap((s) => [...s.values]);
  const high = niceMax(peak);

  return orientation === 'vertical' ? (
    <Vertical
      measuredRef={plotRef}
      width={width}
      height={height ?? 160}
      categories={categories}
      series={drawn}
      stacked={stacked}
      high={high}
      totals={totals}
      format={format}
      labels={labels}
      shown={shown}
    />
  ) : (
    <Horizontal
      measuredRef={plotRef}
      width={width}
      rowHeight={rowHeight}
      categories={categories}
      series={drawn}
      stacked={stacked}
      high={high}
      totals={totals}
      format={format}
      labels={labels}
      shown={shown}
    />
  );
}

/**
 * Where each stacked segment starts: the running total of the series below it. Worked out in one
 * pass up front so that drawing a bar never depends on the bar drawn before it.
 */
function stackBases(categoryCount: number, series: BarSeries[]): number[][] {
  const bases: number[][] = [];
  for (let index = 0; index < categoryCount; index += 1) {
    const row: number[] = [];
    let running = 0;
    for (const s of series) {
      row.push(running);
      running += s.values[index] ?? 0;
    }
    bases.push(row);
  }
  return bases;
}

/** A figure printed on a bar, arriving once the bar has finished growing under it. */
function BarValue({
  x,
  y,
  text,
  shown,
  delay,
  anchor = 'start',
}: {
  x: number;
  y: number;
  text: string;
  shown: boolean;
  delay: number;
  anchor?: 'start' | 'middle';
}) {
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      fontSize={TYPE.value}
      fontWeight={500}
      fill={ink.value}
      style={{
        opacity: shown ? 1 : 0,
        transition: `opacity 200ms ${motion.ease} ${delay}ms`,
      }}
    >
      {text}
    </text>
  );
}

interface LayoutProps {
  measuredRef: (node: HTMLDivElement | null) => void;
  width: number;
  categories: string[];
  series: BarSeries[];
  stacked: boolean;
  high: number;
  totals: number[];
  format: (value: number) => string;
  labels: boolean;
  shown: boolean;
}

function Vertical({
  measuredRef,
  width,
  height,
  categories,
  series,
  stacked,
  high,
  totals,
  format,
  labels,
  shown,
}: LayoutProps & { height: number }) {
  const top = labels ? 16 : 4;
  const bottom = height - 18;
  const band = scaleBand<number>()
    .domain(categories.map((_, index) => index))
    .range([1, width - 1])
    .paddingInner(0.34)
    .paddingOuter(0.16);
  const inner = scaleBand<number>()
    .domain(series.map((_, index) => index))
    .range([0, band.bandwidth()])
    .paddingInner(0.14);
  const value = scaleLinear().domain([0, high]).range([bottom, top]);
  const bases = stackBases(categories.length, series);

  return (
    <div ref={measuredRef} className="w-full">
      <svg
        aria-hidden
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ display: 'block', width: '100%', height }}
      >
        <line x1={1} x2={width - 1} y1={bottom} y2={bottom} stroke={ink.baseline} strokeWidth={1} />

        {categories.map((category, index) => {
          const x0 = band(index) ?? 0;
          return (
            <g key={`${category}-${index}`}>
              {series.map((s, sIndex) => {
                const raw = s.values[index] ?? 0;
                const base = stacked ? (bases[index]?.[sIndex] ?? 0) : 0;
                const colour = s.color ?? seriesColor(sIndex);
                const barWidth = stacked ? band.bandwidth() : inner.bandwidth();
                const x = stacked ? x0 : x0 + (inner(sIndex) ?? 0);
                const y = value(base + raw);
                const size = value(base) - y;
                const last = sIndex === series.length - 1;
                return (
                  <g key={s.key}>
                    <path
                      d={barPath(x, y, barWidth, size, 3, stacked && !last ? 'none' : 'top')}
                      fill={colour}
                      style={{
                        transform: shown ? 'none' : 'scaleY(0)',
                        transformOrigin: `0px ${bottom}px`,
                        transition: `transform ${motion.grow}ms ${motion.ease} ${index * motion.stagger}ms`,
                      }}
                    >
                      <title>{`${category}: ${s.label} ${format(raw)}`}</title>
                    </path>
                    {labels && !stacked && (
                      <BarValue
                        x={x + barWidth / 2}
                        y={y - 5}
                        anchor="middle"
                        text={format(raw)}
                        shown={shown}
                        delay={motion.grow + index * motion.stagger}
                      />
                    )}
                  </g>
                );
              })}

              {labels && stacked && (
                <BarValue
                  x={x0 + band.bandwidth() / 2}
                  y={value(totals[index] ?? 0) - 5}
                  anchor="middle"
                  text={format(totals[index] ?? 0)}
                  shown={shown}
                  delay={motion.grow + index * motion.stagger}
                />
              )}

              <text
                x={x0 + band.bandwidth() / 2}
                y={height - 5}
                textAnchor="middle"
                fontSize={TYPE.tick}
                fill={ink.context}
              >
                {category}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Horizontal({
  measuredRef,
  width,
  rowHeight,
  categories,
  series,
  stacked,
  high,
  totals,
  format,
  labels,
  shown,
}: LayoutProps & { rowHeight: number }) {
  const height = categories.length * rowHeight + 2;
  // The category column is as wide as its longest name needs, and never more than a third of the
  // chart, because past that the bars have nowhere left to be.
  const longest = Math.max(...categories.map((c) => textWidth(c, TYPE.value)));
  const left = Math.min(Math.max(48, longest + 10), width * 0.34);
  const valueRoom = labels ? textWidth(format(high), TYPE.value) + 10 : 2;
  const right = width - valueRoom;

  const band = scaleBand<number>()
    .domain(categories.map((_, index) => index))
    .range([0, height])
    .paddingInner(0.3)
    .paddingOuter(0.1);
  const inner = scaleBand<number>()
    .domain(series.map((_, index) => index))
    .range([0, band.bandwidth()])
    .paddingInner(0.18);
  const value = scaleLinear().domain([0, high]).range([left, right]);
  const bases = stackBases(categories.length, series);

  return (
    <div ref={measuredRef} className="w-full">
      <svg
        aria-hidden
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ display: 'block', width: '100%', height }}
      >
        <line x1={left} x2={left} y1={1} y2={height - 1} stroke={ink.baseline} strokeWidth={1} />

        {categories.map((category, index) => {
          const y0 = band(index) ?? 0;
          return (
            <g key={`${category}-${index}`}>
              <text
                x={left - 8}
                y={y0 + band.bandwidth() / 2 + 4}
                textAnchor="end"
                fontSize={TYPE.value}
                fill={ink.context}
              >
                {category}
              </text>

              {series.map((s, sIndex) => {
                const raw = s.values[index] ?? 0;
                const base = stacked ? (bases[index]?.[sIndex] ?? 0) : 0;
                const colour = s.color ?? seriesColor(sIndex);
                const barHeight = stacked ? band.bandwidth() : inner.bandwidth();
                const y = stacked ? y0 : y0 + (inner(sIndex) ?? 0);
                const x = value(base);
                const size = value(base + raw) - x;
                const last = sIndex === series.length - 1;
                return (
                  <g key={s.key}>
                    <path
                      d={barPath(x, y, size, barHeight, 3, stacked && !last ? 'none' : 'right')}
                      fill={colour}
                      style={{
                        transform: shown ? 'none' : 'scaleX(0)',
                        transformOrigin: `${left}px 0px`,
                        transition: `transform ${motion.grow}ms ${motion.ease} ${index * motion.stagger}ms`,
                      }}
                    >
                      <title>{`${category}: ${s.label} ${format(raw)}`}</title>
                    </path>
                    {labels && !stacked && (
                      <BarValue
                        x={x + size + 6}
                        y={y + barHeight / 2 + 4}
                        text={format(raw)}
                        shown={shown}
                        delay={motion.grow + index * motion.stagger}
                      />
                    )}
                  </g>
                );
              })}

              {labels && stacked && (
                <BarValue
                  x={value(totals[index] ?? 0) + 6}
                  y={y0 + band.bandwidth() / 2 + 4}
                  text={format(totals[index] ?? 0)}
                  shown={shown}
                  delay={motion.grow + index * motion.stagger}
                />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
