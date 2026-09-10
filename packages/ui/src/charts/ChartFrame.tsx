/**
 * The container every chart sits in: a label, the figure that matters, what it did lately, and the
 * plot underneath. No border and no card of its own, because the screen has already put it in one.
 *
 * It also carries the chart's numbers as a table that only a screen reader sees. A drawn series is
 * a picture, and `aria-label` on a picture can only ever summarise it. The table is the same
 * figures the chart was drawn from, so nobody is asked to take a summary on trust. That is why the
 * plot itself is hidden from assistive technology: one set of numbers, read one way, not two.
 */
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../utils.js';
import { motion, useCountUp } from './style.js';

export interface ChartDelta {
  /** Said in words, because an arrow and a percentage alone do not say over what. */
  label: string;
  direction: 'up' | 'down' | 'flat';
  /**
   * Whether the movement is good news. The chart cannot know: storage climbing is bad, revenue
   * climbing is good, and seats climbing is neither, so the screen decides.
   */
  tone?: 'positive' | 'negative' | 'neutral';
}

export interface LegendItem {
  label: string;
  color: string;
  /** Drawn as a dashed swatch, matching a dashed series or a cap rule. */
  dashed?: boolean;
}

/** The chart's figures, written out for a screen reader. */
export interface ChartTable {
  /** What the table is of, such as "Seats in use per day". */
  caption: string;
  /** The first column heads each row, so the rest of the row has something to be about. */
  columns: string[];
  rows: (string | number)[][];
}

export function ChartFrame({
  label,
  value,
  delta,
  legend,
  footnote,
  table,
  children,
  className,
}: {
  label: ReactNode;
  value?: ReactNode;
  delta?: ChartDelta;
  legend?: LegendItem[];
  footnote?: ReactNode;
  table: ChartTable;
  children: ReactNode;
  className?: string;
}) {
  return (
    <figure className={cn('m-0 flex min-w-0 flex-col gap-3', className)}>
      <figcaption className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="text-sm font-medium text-muted">{label}</span>
          {legend !== undefined && legend.length > 0 && <ChartLegend items={legend} />}
        </div>
        {(value !== undefined || delta !== undefined) && (
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
            {value !== undefined && (
              <span className="tnum text-2xl leading-none font-semibold tracking-tight">
                {value}
              </span>
            )}
            {delta !== undefined && <Delta {...delta} />}
          </div>
        )}
      </figcaption>

      <div className="min-w-0">{children}</div>

      {footnote !== undefined && <p className="m-0 text-sm text-faint">{footnote}</p>}

      {table.rows.length > 0 && <HiddenTable {...table} />}
    </figure>
  );
}

function Delta({ label, direction, tone = 'neutral' }: ChartDelta) {
  const Icon = direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : Minus;
  const colour =
    tone === 'positive' ? 'text-success' : tone === 'negative' ? 'text-danger' : 'text-muted';
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-sm', colour)}>
      <Icon size={13} aria-hidden />
      {label}
    </span>
  );
}

export function ChartLegend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="m-0 flex list-none flex-wrap items-center gap-x-3 gap-y-1 p-0">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5 text-sm text-muted">
          <span
            aria-hidden
            className="inline-block h-0 w-3 shrink-0 border-t-2"
            style={{
              borderColor: item.color,
              borderTopStyle: item.dashed === true ? 'dashed' : 'solid',
            }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

function HiddenTable({ caption, columns, rows }: ChartTable) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column} scope="col">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={`${String(row[0] ?? '')}-${index}`}>
            {row.map((cell, column) =>
              column === 0 ? (
                <th key={column} scope="row">
                  {cell}
                </th>
              ) : (
                <td key={column}>{cell}</td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * A figure that counts up to itself when it first appears, and from its old value to its new one
 * when it changes. Formatting is the caller's, so the same component counts seats, bytes and money.
 */
export function CountUp({
  value,
  format,
  duration = motion.count,
}: {
  value: number;
  format: (value: number) => string;
  duration?: number;
}) {
  const shown = useCountUp(value, duration);
  // The animated figure is for the eye only: a screen reader is told the settled one once, rather
  // than being interrupted thirty times on the way to it.
  return (
    <>
      <span aria-hidden>{format(shown)}</span>
      <span className="sr-only">{format(value)}</span>
    </>
  );
}

/**
 * What a chart shows before it has anything to show. It keeps the height the plot will have and
 * draws the baseline it will stand on, so the card does not jump when the first samples arrive.
 */
export function ChartEmpty({
  height = 120,
  label = 'No samples yet',
}: {
  height?: number;
  label?: string;
}) {
  return (
    <div className="relative flex items-center justify-center" style={{ height }}>
      <span
        aria-hidden
        className="absolute inset-x-0 bottom-0 border-b border-dashed border-border"
      />
      <p className="m-0 text-sm text-faint">{label}</p>
    </div>
  );
}
