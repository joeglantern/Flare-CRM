/**
 * TagInput and TagList (Component Inventory · Entity components): tag entry with suggestions from
 * existing tags, and the read-only chip list used in tables.
 */
import { useMemo, useRef, useState } from 'react';
import { Tag } from '@/components/ui/Badge';
import { FieldShell } from '@/components/ui/Input';
import { Popover } from '@/components/ui/Menu';
import { cn } from '@/lib/utils';

export function TagList({
  tags,
  max = 3,
  className,
}: {
  tags: string[];
  max?: number;
  className?: string;
}) {
  if (tags.length === 0) return <span className="text-faint">—</span>;
  const shown = tags.slice(0, max);
  const rest = tags.length - shown.length;
  return (
    <span className={cn('flex min-w-0 items-center gap-1', className)}>
      {shown.map((t) => (
        <Tag key={t}>{t}</Tag>
      ))}
      {rest > 0 && (
        <span className="shrink-0 text-xs text-faint" title={tags.slice(max).join(', ')}>
          +{rest}
        </span>
      )}
    </span>
  );
}

export function TagInput({
  value,
  onChange,
  suggestions = [],
  max = 30,
  label = 'Tags',
  error,
  className,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  suggestions?: string[];
  max?: number;
  label?: string;
  error?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState('');
  const box = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);

  const matches = useMemo(() => {
    const q = draft.trim().toLowerCase();
    return suggestions
      .filter((s) => !value.includes(s) && (q === '' || s.toLowerCase().includes(q)))
      .slice(0, 8);
  }, [suggestions, draft, value]);

  const add = (tag: string) => {
    const clean = tag.trim().toLowerCase();
    if (clean === '' || value.includes(clean) || value.length >= max) return;
    onChange([...value, clean]);
    setDraft('');
  };

  return (
    <FieldShell
      label={label}
      error={error}
      className={className}
      aside={`${String(value.length)} / ${String(max)}`}
    >
      <div
        ref={box}
        className={cn(
          'flex min-h-8 flex-wrap items-center gap-1 rounded-sm border bg-bg px-2 py-1',
          error !== undefined && error !== ''
            ? 'border-danger'
            : 'border-strong focus-within:border-flare',
        )}
      >
        {value.map((t) => (
          <Tag
            key={t}
            onRemove={() => {
              onChange(value.filter((x) => x !== t));
            }}
          >
            {t}
          </Tag>
        ))}
        <input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add(draft);
            } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
              onChange(value.slice(0, -1));
            }
          }}
          placeholder={value.length === 0 ? 'Add a tag and press Enter' : ''}
          aria-label="Add a tag"
          className="h-6 min-w-[120px] flex-1 bg-transparent text-base outline-none placeholder:text-faint"
        />
      </div>
      <Popover open={open && matches.length > 0} onOpenChange={setOpen} anchor={box} matchWidth>
        {matches.map((s) => (
          <button
            key={s}
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              add(s);
            }}
            className="flex w-full rounded-sm px-2 py-1.5 text-left text-base hover:bg-hover"
          >
            {s}
          </button>
        ))}
      </Popover>
    </FieldShell>
  );
}
