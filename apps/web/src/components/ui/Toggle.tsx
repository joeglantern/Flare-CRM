/**
 * Checkbox, Switch and RadioGroup (Component Inventory · Primitives).
 * They share one label / description / disabled contract; `title` explains *why* something is
 * disabled, which Settings relies on ("admins cannot turn this off").
 */
import { Check, Minus } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface CheckboxProps {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
  description?: string;
  disabled?: boolean;
  title?: string;
  className?: string;
  /** Accessible name when there is no visible label (bulk-selection cells). */
  ariaLabel?: string;
}

export function Checkbox({
  checked,
  indeterminate = false,
  onChange,
  label,
  description,
  disabled = false,
  title,
  className,
  ariaLabel,
}: CheckboxProps) {
  const id = useId();
  return (
    <div className={cn('flex items-start gap-2', className)} title={title}>
      <button
        id={id}
        type="button"
        role="checkbox"
        aria-checked={indeterminate ? 'mixed' : checked}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => {
          onChange(!checked);
        }}
        className={cn(
          'mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors duration-[var(--dur-hover)]',
          checked || indeterminate
            ? 'border-flare bg-flare text-[var(--on-flare)]'
            : 'border-strong bg-bg hover:border-[var(--text-faint)]',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        {indeterminate ? (
          <Minus size={12} strokeWidth={2.5} aria-hidden />
        ) : checked ? (
          <Check size={12} strokeWidth={2.5} aria-hidden />
        ) : null}
      </button>
      {(label !== undefined || description !== undefined) && (
        <label htmlFor={id} className={cn('min-w-0 text-base', disabled && 'text-faint')}>
          {label}
          {description !== undefined && <div className="text-sm text-muted">{description}</div>}
        </label>
      )}
    </div>
  );
}

export interface SwitchProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
  description?: string;
  disabled?: boolean;
  title?: string;
  className?: string;
  ariaLabel?: string;
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  title,
  className,
  ariaLabel,
}: SwitchProps) {
  const id = useId();
  return (
    <div className={cn('flex items-start gap-2.5', className)} title={title}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => {
          onChange(!checked);
        }}
        className={cn(
          'relative mt-0.5 h-4 w-7 shrink-0 rounded-full transition-colors duration-[var(--dur-hover)]',
          checked ? 'bg-flare' : 'bg-strong',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-3 w-3 rounded-full transition-[left] duration-[var(--dur-hover)] ease-[var(--ease-out)]',
            checked ? 'left-[14px] bg-white' : 'left-0.5 bg-[var(--text-muted)]',
          )}
        />
      </button>
      {(label !== undefined || description !== undefined) && (
        <label htmlFor={id} className={cn('min-w-0 text-base', disabled && 'text-faint')}>
          {label}
          {description !== undefined && <div className="text-sm text-muted">{description}</div>}
        </label>
      )}
    </div>
  );
}

export interface RadioOption<T extends string> {
  value: T;
  label: ReactNode;
  description?: string;
  disabled?: boolean;
}

export interface RadioGroupProps<T extends string> {
  value: T;
  onChange: (v: T) => void;
  options: RadioOption<T>[];
  label?: string;
  name?: string;
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}

export function RadioGroup<T extends string>({
  value,
  onChange,
  options,
  label,
  orientation = 'vertical',
  className,
}: RadioGroupProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        'flex gap-3',
        orientation === 'vertical' ? 'flex-col' : 'flex-wrap items-center',
        className,
      )}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          onClick={() => {
            onChange(o.value);
          }}
          className={cn(
            'flex items-start gap-2 text-left text-base',
            o.disabled === true && 'cursor-not-allowed opacity-50',
          )}
        >
          <span
            className={cn(
              'mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
              value === o.value ? 'border-flare' : 'border-strong',
            )}
          >
            {value === o.value && <i className="h-2 w-2 rounded-full bg-flare" />}
          </span>
          <span className="min-w-0">
            {o.label}
            {o.description !== undefined && (
              <div className="text-sm text-muted">{o.description}</div>
            )}
          </span>
        </button>
      ))}
    </div>
  );
}

export interface SegmentedProps<T extends string> {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; count?: number }[];
  ariaLabel?: string;
  className?: string;
}

/** The quick-filter control from the design system ("Mine / Team / Overdue / Today"). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  className,
}: SegmentedProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex shrink-0 rounded-sm border border-border bg-bg p-0.5 text-sm',
        className,
      )}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => {
            onChange(o.value);
          }}
          className={cn(
            'rounded-[4px] px-2.5 py-1 whitespace-nowrap transition-colors duration-[var(--dur-hover)]',
            value === o.value ? 'bg-hover font-medium text-text' : 'text-muted hover:text-text',
          )}
        >
          {o.label}
          {o.count !== undefined && <span className="ml-1.5 text-xs text-faint">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}
