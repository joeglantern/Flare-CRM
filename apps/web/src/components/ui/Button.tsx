/**
 * Button and IconButton (Component Inventory · Primitives).
 * Variants and states are pinned to the design system table: primary, secondary, ghost, danger,
 * each with default / hover / pressed / disabled / loading. Loading swaps the label for a spinner
 * without changing width so toolbars never jump.
 */
import type { LucideIcon } from 'lucide-react';
import { Loader } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type ForwardedRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Kbd } from './Kbd';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    'border-flare bg-flare text-[var(--on-flare)] hover:border-flare-hover hover:bg-flare-hover active:border-flare-pressed active:bg-flare-pressed',
  secondary:
    'border-strong bg-surface text-text hover:bg-hover active:bg-bg disabled:border-border disabled:text-faint',
  ghost:
    'border-transparent bg-transparent text-muted hover:bg-hover hover:text-text active:bg-bg disabled:text-faint',
  danger:
    'border-danger bg-transparent text-danger hover:bg-[var(--danger-subtle)] active:bg-danger active:text-white disabled:border-border disabled:text-faint',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-[28px] px-2.5 text-sm',
  md: 'h-8 px-3 text-base',
  lg: 'h-9 px-3.5 text-base',
};

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  iconPosition?: 'start' | 'end';
  loading?: boolean;
  /** Key hint rendered at the end, e.g. "↵". */
  kbd?: string;
  full?: boolean;
  type?: 'button' | 'submit' | 'reset';
  children?: ReactNode;
}

export const Button = forwardRef(function Button(
  {
    variant = 'secondary',
    size = 'md',
    icon: Icon,
    iconPosition = 'start',
    loading = false,
    disabled,
    kbd,
    full,
    className,
    children,
    type = 'button',
    ...rest
  }: ButtonProps,
  ref: ForwardedRef<HTMLButtonElement>,
) {
  const iconSize = size === 'sm' ? 13 : 14;
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-sm border font-medium whitespace-nowrap',
        'transition-[background-color,border-color,color] duration-[var(--dur-hover)] ease-[var(--ease-out)]',
        'disabled:cursor-not-allowed disabled:opacity-60',
        VARIANT[variant],
        SIZE[size],
        full === true && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Loader size={iconSize} className="spin shrink-0" aria-hidden />
      ) : (
        Icon !== undefined &&
        iconPosition === 'start' && <Icon size={iconSize} className="shrink-0" aria-hidden />
      )}
      {children}
      {!loading && Icon !== undefined && iconPosition === 'end' && (
        <Icon size={iconSize} className="shrink-0" aria-hidden />
      )}
      {kbd !== undefined && <Kbd className="ml-1">{kbd}</Kbd>}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  icon: LucideIcon;
  /** Tooltip text and accessible name. Required: an icon alone is never self-describing. */
  label: string;
  variant?: 'ghost' | 'secondary' | 'danger';
  size?: 26 | 28 | 32;
  loading?: boolean;
  active?: boolean;
}

export const IconButton = forwardRef(function IconButton(
  {
    icon: Icon,
    label,
    variant = 'secondary',
    size = 28,
    loading = false,
    active = false,
    disabled,
    className,
    ...rest
  }: IconButtonProps,
  ref: ForwardedRef<HTMLButtonElement>,
) {
  const glyph = size <= 26 ? 13 : size === 28 ? 14 : 16;
  return (
    <button
      ref={ref}
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active ? true : undefined}
      disabled={disabled === true || loading}
      style={{ width: size, height: size }}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-sm border',
        'transition-[background-color,border-color,color] duration-[var(--dur-hover)] ease-[var(--ease-out)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'secondary' && 'border-strong bg-surface text-text hover:bg-hover',
        variant === 'ghost' &&
          'border-transparent bg-transparent text-muted hover:bg-hover hover:text-text',
        variant === 'danger' &&
          'border-transparent bg-transparent text-danger hover:bg-[var(--danger-subtle)]',
        active && 'border-flare bg-[var(--flare-subtle)] text-flare-on',
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Loader size={glyph} className="spin" aria-hidden />
      ) : (
        <Icon size={glyph} aria-hidden />
      )}
    </button>
  );
});
