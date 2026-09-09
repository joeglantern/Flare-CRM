/**
 * Badge (Component Inventory · Primitives): the pill behind every status, direction, priority and
 * tag. Tone maps to semantic colours only — never a bespoke colour at the call site.
 */
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from './utils.js';

export type BadgeTone = 'neutral' | 'outline' | 'flare' | 'success' | 'warning' | 'danger' | 'info';

const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-hover text-muted',
  outline: 'border border-border text-muted',
  flare: 'bg-[var(--flare-subtle)] text-flare-on font-medium',
  success: 'bg-[var(--success-subtle)] text-success font-medium',
  warning: 'bg-[var(--warning-subtle)] text-warning font-medium',
  danger: 'bg-[var(--danger-subtle)] text-danger font-medium',
  info: 'bg-[var(--info-subtle)] text-info font-medium',
};

const DOT: Record<BadgeTone, string> = {
  neutral: 'bg-[var(--text-faint)]',
  outline: 'bg-[var(--text-faint)]',
  flare: 'bg-flare',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
};

export interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  icon?: LucideIcon;
  dot?: boolean;
  /** Ringing only — the single looping animation in the product. */
  pulse?: boolean;
  /** Slow opacity pulse used for a live/talking state. */
  live?: boolean;
  className?: string;
  title?: string;
}

export function Badge({
  children,
  tone = 'outline',
  icon: Icon,
  dot = false,
  pulse = false,
  live = false,
  className,
  title,
}: BadgeProps) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full px-2 text-sm whitespace-nowrap',
        TONE[tone],
        className,
      )}
    >
      {dot && (
        <i
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            DOT[tone],
            pulse && 'ring-pulse',
            live && 'live-pulse',
          )}
          aria-hidden
        />
      )}
      {Icon !== undefined && <Icon size={12} className="shrink-0" aria-hidden />}
      {children}
    </span>
  );
}

/** Small square chip used for tags (docs/18: 20px, 4px radius, not a pill). */
export function Tag({
  children,
  onRemove,
  className,
}: {
  children: ReactNode;
  onRemove?: () => void;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 rounded border border-border bg-hover px-1.5 text-xs',
        className,
      )}
    >
      {children}
      {onRemove !== undefined && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={typeof children === 'string' ? `Remove ${children}` : 'Remove'}
          className="text-faint hover:text-text"
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            aria-hidden
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </span>
  );
}
