/**
 * Select (Component Inventory · Primitives): single-select listbox, keyboard navigable,
 * optionally searchable. Built on Popover so it escapes table and drawer overflow.
 */
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { FieldShell } from './Input';
import { Popover } from './Menu';

export interface SelectOption {
  value: string;
  label: string;
  icon?: LucideIcon;
  description?: string;
  disabled?: boolean;
  /** Rendered instead of the plain label (avatars, colour swatches). */
  render?: ReactNode;
}

export interface SelectProps {
  value: string | null;
  onChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  label?: ReactNode;
  description?: ReactNode;
  error?: string | undefined;
  searchable?: boolean;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  size?: 'sm' | 'md';
  ariaLabel?: string;
}

export function Select({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  label,
  description,
  error,
  searchable = false,
  disabled = false,
  required,
  className,
  size = 'md',
  ariaLabel,
}: SelectProps) {
  const trigger = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const listId = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q === '' ? options : options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  const selected = options.find((o) => o.value === value) ?? null;
  const invalid = error !== undefined && error !== '';
  // A combobox cannot take its name from its content, so the visible label is wired to the
  // trigger by id; with neither a label nor an explicit name, the placeholder stands in.
  const triggerId = `${listId}-trigger`;
  const name = ariaLabel ?? (label === undefined ? placeholder : undefined);

  return (
    <FieldShell
      label={label}
      description={description}
      error={error}
      required={required}
      className={className}
      htmlFor={triggerId}
    >
      <button
        ref={trigger}
        id={triggerId}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${listId}-options`}
        aria-haspopup="listbox"
        aria-label={name}
        disabled={disabled}
        onClick={() => {
          setOpen((o) => !o);
          setQuery('');
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'Enter') {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          'flex w-full items-center gap-2 rounded-sm border bg-bg px-2.5 text-left',
          size === 'sm' ? 'h-[28px] text-sm' : 'h-8 text-base',
          invalid ? 'border-danger' : 'border-strong',
          disabled && 'cursor-not-allowed text-faint',
        )}
      >
        {selected?.icon !== undefined && (
          <selected.icon size={14} className="shrink-0 text-muted" aria-hidden />
        )}
        {/* muted, not faint: a placeholder is still text someone has to read, and faint on the
            dark theme is 3.8:1, under the 4.5:1 floor */}
        <span className={cn('min-w-0 flex-1 truncate', selected === null && 'text-muted')}>
          {selected?.render ?? selected?.label ?? placeholder}
        </span>
        <ChevronsUpDown size={14} className="shrink-0 text-muted" aria-hidden />
      </button>

      <Popover open={open} onOpenChange={setOpen} anchor={trigger} matchWidth ariaLabel={ariaLabel}>
        {searchable && (
          <div className="mb-1 flex items-center gap-2 border-b border-border px-2 pb-1.5">
            <Search size={14} className="shrink-0 text-muted" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActive((a) => Math.min(a + 1, shown.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActive((a) => Math.max(a - 1, 0));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  const o = shown[active];
                  if (o && o.disabled !== true) {
                    onChange(o.value);
                    setOpen(false);
                  }
                }
              }}
              placeholder="Search…"
              className="h-7 w-full bg-transparent text-base outline-none placeholder:text-faint"
            />
          </div>
        )}
        <div role="listbox" aria-label={ariaLabel}>
          {shown.length === 0 && (
            <div className="px-2 py-3 text-center text-sm text-faint">No matches</div>
          )}
          {shown.map((o, i) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              disabled={o.disabled}
              onMouseEnter={() => {
                setActive(i);
              }}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-base',
                o.disabled === true
                  ? 'cursor-not-allowed text-faint'
                  : i === active
                    ? 'bg-hover'
                    : 'hover:bg-hover',
              )}
            >
              {o.icon !== undefined && (
                <o.icon size={14} className="shrink-0 text-muted" aria-hidden />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate">{o.render ?? o.label}</span>
                {o.description !== undefined && (
                  <span className="block truncate text-sm text-muted">{o.description}</span>
                )}
              </span>
              {o.value === value && <Check size={14} className="shrink-0 text-flare" aria-hidden />}
            </button>
          ))}
        </div>
      </Popover>
    </FieldShell>
  );
}
