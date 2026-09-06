/**
 * FilterBar, FilterChip, SavedViews and DateRangePicker (Component Inventory · Forms and filters).
 * Filter state lives in the query string, so a filtered list can be shared and an export carries
 * the same filters.
 *
 * GAP-11: there is no saved-view endpoint. Saved views are named URL bookmarks in local storage,
 * per user and per list, and the UI never implies they are shared with the team.
 */
import { Bookmark, BookmarkPlus, Check, ChevronDown, Search, X } from 'lucide-react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, IconButton } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Popover } from '@/components/ui/Menu';
import { Tooltip } from '@/components/ui/Tooltip';
import { cn } from '@/lib/utils';

export interface FilterOption {
  value: string;
  label: string;
  count?: number;
}

export interface FilterDefinition {
  key: string;
  label: string;
  options: FilterOption[];
  /** Renders as always-visible chips instead of a dropdown. */
  quick?: boolean;
}

export function FilterChip({
  label,
  value,
  options,
  onChange,
  align = 'start',
}: {
  label: string;
  value: string | undefined;
  options: FilterOption[];
  onChange: (v: string | undefined) => void;
  align?: 'start' | 'end';
}) {
  const anchor = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        onClick={() => {
          setOpen((o) => !o);
        }}
        className={cn(
          'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-sm whitespace-nowrap',
          selected !== undefined
            ? 'border-flare bg-[var(--flare-subtle)] font-medium text-flare-on'
            : 'border-border text-muted hover:text-text',
        )}
      >
        {label}
        {selected !== undefined && <span className="text-text">· {selected.label}</span>}
        <ChevronDown size={12} aria-hidden />
      </button>
      <Popover open={open} onOpenChange={setOpen} anchor={anchor} align={align} width={220}>
        <button
          type="button"
          onClick={() => {
            onChange(undefined);
            setOpen(false);
          }}
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-base hover:bg-hover"
        >
          <span className="flex-1">Any</span>
          {value === undefined && <Check size={14} className="text-flare" aria-hidden />}
        </button>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => {
              onChange(o.value);
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-base hover:bg-hover"
          >
            <span className="min-w-0 flex-1 truncate">{o.label}</span>
            {o.count !== undefined && <span className="tnum text-sm text-faint">{o.count}</span>}
            {o.value === value && <Check size={14} className="text-flare" aria-hidden />}
          </button>
        ))}
      </Popover>
    </>
  );
}

export function FilterBar({
  search,
  onSearchChange,
  searchPlaceholder = 'Search…',
  children,
  activeCount,
  onClear,
  right,
  savedViewsKey,
}: {
  search?: string;
  onSearchChange?: (v: string) => void;
  searchPlaceholder?: string;
  children?: ReactNode;
  activeCount?: number;
  onClear?: () => void;
  right?: ReactNode;
  savedViewsKey?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {onSearchChange !== undefined && (
        <Input
          value={search ?? ''}
          onChange={(e) => {
            onSearchChange(e.target.value);
          }}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          prefix={<Search size={14} aria-hidden />}
          containerClassName="w-full max-w-[280px]"
        />
      )}
      {children}
      {activeCount !== undefined && activeCount > 0 && onClear !== undefined && (
        <Button size="sm" variant="ghost" icon={X} onClick={onClear}>
          Clear {activeCount}
        </Button>
      )}
      {savedViewsKey !== undefined && <SavedViews storageKey={savedViewsKey} />}
      {right !== undefined && (
        <div className="ml-auto flex flex-wrap items-center gap-2">{right}</div>
      )}
    </div>
  );
}

interface SavedView {
  name: string;
  search: string;
}

/** GAP-11: local-storage bookmarks, deliberately personal rather than shared. */
export function SavedViews({ storageKey }: { storageKey: string }) {
  const navigate = useNavigate();
  const location = useRouterState({ select: (s) => s.location });
  const anchor = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const key = `flare.views.${storageKey}`;

  const [views, setViews] = useState<SavedView[]>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? [] : (JSON.parse(raw) as SavedView[]);
    } catch {
      return [];
    }
  });

  const persist = (next: SavedView[]) => {
    setViews(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* private mode */
    }
  };

  const currentSearch = useMemo(() => {
    const params = new URLSearchParams(
      Object.entries(location.search as Record<string, unknown>)
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => [k, String(v)]),
    );
    return params.toString();
  }, [location.search]);

  return (
    <>
      <Button
        ref={anchor}
        size="sm"
        variant="ghost"
        icon={Bookmark}
        onClick={() => {
          setOpen((o) => !o);
        }}
      >
        Views
      </Button>
      <Popover open={open} onOpenChange={setOpen} anchor={anchor} width={260}>
        <div className="flex flex-col gap-1 p-1">
          {views.length === 0 && (
            <p className="px-2 py-3 text-sm text-muted">
              No saved views yet. Views are saved on this device for you only.
            </p>
          )}
          {views.map((v) => (
            <div key={v.name} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  void navigate({
                    to: location.pathname,
                    search: Object.fromEntries(new URLSearchParams(v.search)) as never,
                  });
                }}
                className="min-w-0 flex-1 truncate rounded-sm px-2 py-1.5 text-left text-base hover:bg-hover"
              >
                {v.name}
              </button>
              <IconButton
                icon={X}
                label={`Delete ${v.name}`}
                size={26}
                variant="ghost"
                onClick={() => {
                  persist(views.filter((x) => x.name !== v.name));
                }}
              />
            </div>
          ))}
          <div className="mt-1 flex items-end gap-1.5 border-t border-border pt-2">
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              placeholder="Name this view"
              aria-label="View name"
              containerClassName="flex-1"
            />
            <Button
              size="sm"
              variant="secondary"
              icon={BookmarkPlus}
              disabled={name.trim() === ''}
              onClick={() => {
                persist([
                  ...views.filter((v) => v.name !== name.trim()),
                  { name: name.trim(), search: currentSearch },
                ]);
                setName('');
              }}
            >
              Save
            </Button>
          </div>
        </div>
      </Popover>
    </>
  );
}

export type RangePreset = 'today' | '7d' | '30d' | 'month' | 'quarter' | 'custom';

export interface DateRange {
  from: string;
  to: string;
  preset?: RangePreset;
}

export function presetRange(preset: RangePreset): DateRange {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (preset === '7d') start.setDate(start.getDate() - 6);
  else if (preset === '30d') start.setDate(start.getDate() - 29);
  else if (preset === 'month') start.setDate(1);
  else if (preset === 'quarter') {
    start.setMonth(Math.floor(start.getMonth() / 3) * 3);
    start.setDate(1);
  }
  return { from: start.toISOString(), to: end.toISOString(), preset };
}

export function DateRangePicker({
  value,
  onChange,
  disabled,
  disabledReason,
  maxDays,
}: {
  value: DateRange;
  onChange: (v: DateRange) => void;
  disabled?: boolean;
  disabledReason?: string;
  maxDays?: number;
}) {
  const anchor = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const presets: { id: RangePreset; label: string }[] = [
    { id: 'today', label: 'Today' },
    { id: '7d', label: 'Last 7 days' },
    { id: '30d', label: 'Last 30 days' },
    { id: 'month', label: 'This month' },
    { id: 'quarter', label: 'This quarter' },
  ];
  const label =
    presets.find((p) => p.id === value.preset)?.label ??
    `${value.from.slice(0, 10)} → ${value.to.slice(0, 10)}`;

  const control = (
    <Button
      ref={anchor}
      size="sm"
      variant="secondary"
      disabled={disabled}
      onClick={() => {
        setOpen((o) => !o);
      }}
    >
      {label}
      <ChevronDown size={12} aria-hidden />
    </Button>
  );

  return (
    <>
      {disabled === true && disabledReason !== undefined ? (
        <Tooltip content={disabledReason}>
          <span>{control}</span>
        </Tooltip>
      ) : (
        control
      )}
      <Popover open={open} onOpenChange={setOpen} anchor={anchor} width={260}>
        <div className="flex flex-col gap-1 p-1">
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                onChange(presetRange(p.id));
                setOpen(false);
              }}
              className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-base hover:bg-hover"
            >
              <span className="flex-1">{p.label}</span>
              {value.preset === p.id && <Check size={14} className="text-flare" aria-hidden />}
            </button>
          ))}
          <div className="mt-1 grid grid-cols-2 gap-2 border-t border-border pt-2">
            <Input
              type="date"
              label="From"
              value={value.from.slice(0, 10)}
              onChange={(e) => {
                onChange({
                  ...value,
                  from: new Date(`${e.target.value}T00:00:00`).toISOString(),
                  preset: 'custom',
                });
              }}
            />
            <Input
              type="date"
              label="To"
              value={value.to.slice(0, 10)}
              onChange={(e) => {
                onChange({
                  ...value,
                  to: new Date(`${e.target.value}T23:59:59`).toISOString(),
                  preset: 'custom',
                });
              }}
            />
          </div>
          {maxDays !== undefined && (
            <p className="px-1 pt-1 text-xs text-faint">Range must be {maxDays} days or less.</p>
          )}
        </div>
      </Popover>
    </>
  );
}
