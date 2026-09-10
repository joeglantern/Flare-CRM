/**
 * Things that happened, in order, on a rail. Used for what is about to expire, for the versions a
 * stack has run, and for the entitlement documents it has been sent.
 *
 * Not drawn in SVG, because this one is text: a date, a line about it, and sometimes a detail. Its
 * rail is a border and its dots are spans, which means the text wraps, selects and zooms like text.
 * It takes its dates already written out, since the design system owns no calendar.
 */
import { motion, useIntro } from './style.js';

export interface TimelineEvent {
  id: string;
  /** The date or time, formatted by the screen. */
  when: string;
  label: string;
  detail?: string | null;
  /** A short phrase carrying the point of the row, such as "in 9 days" or "rejected". */
  lead?: string;
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
}

const DOTS = {
  neutral: 'var(--text-faint)',
  accent: 'var(--chart-1)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
} as const;

const LEADS = {
  neutral: 'text-faint',
  accent: 'text-flare-on',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
} as const;

export function EventTimeline({
  events,
  emptyLabel = 'Nothing has happened yet',
}: {
  events: TimelineEvent[];
  emptyLabel?: string;
}) {
  const shown = useIntro();

  if (events.length === 0) {
    return <p className="m-0 py-6 text-center text-sm text-faint">{emptyLabel}</p>;
  }

  return (
    <ol className="m-0 list-none p-0">
      {events.map((event, index) => {
        const tone = event.tone ?? 'neutral';
        const last = index === events.length - 1;
        return (
          <li
            key={event.id}
            className="relative flex gap-3 pb-3.5 last:pb-0"
            style={{
              opacity: shown ? 1 : 0,
              transform: shown ? 'none' : 'translateY(4px)',
              transition: `opacity 280ms ${motion.ease} ${index * motion.stagger}ms, transform 280ms ${motion.ease} ${index * motion.stagger}ms`,
            }}
          >
            <span className="tnum w-14 shrink-0 pt-px text-right text-sm text-faint">
              {event.when}
            </span>
            <span className="relative flex w-2 shrink-0 justify-center">
              <span
                aria-hidden
                className="mt-1.5 size-2 shrink-0 rounded-full"
                style={{ background: DOTS[tone] }}
              />
              {/* The rail joins this row to the next one, so the last row has nothing to join to. */}
              {!last && (
                <span aria-hidden className="absolute top-4 bottom-[-14px] w-px bg-border" />
              )}
            </span>
            <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3">
              <div className="min-w-0">
                <p className="m-0 text-base">{event.label}</p>
                {event.detail !== undefined && event.detail !== null && event.detail !== '' && (
                  <p className="m-0 text-sm text-muted">{event.detail}</p>
                )}
              </div>
              {event.lead !== undefined && (
                <span className={`shrink-0 text-sm ${LEADS[tone]}`}>{event.lead}</span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
