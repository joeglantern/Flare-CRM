/**
 * Popover, DropdownMenu and Tabs (Component Inventory · App shell).
 * Menus are keyboard navigable and portal-rendered so they escape table overflow.
 */
import type { LucideIcon } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { useResetWhen } from './hooks.js';
import { cn } from './utils.js';

export interface PopoverProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  anchor: RefObject<HTMLElement | null>;
  children: ReactNode;
  align?: 'start' | 'end' | 'center';
  side?: 'bottom' | 'top';
  /** Match the trigger's width, for comboboxes. */
  matchWidth?: boolean;
  width?: number;
  className?: string;
  ariaLabel?: string;
}

export function Popover({
  open,
  onOpenChange,
  anchor,
  children,
  align = 'start',
  side = 'bottom',
  matchWidth = false,
  width,
  className,
  ariaLabel,
}: PopoverProps) {
  const panel = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<{ top: number; left: number; minWidth?: number }>({
    top: 0,
    left: 0,
  });

  const place = () => {
    const a = anchor.current;
    const p = panel.current;
    if (!a || !p) return;
    const r = a.getBoundingClientRect();
    const pr = p.getBoundingClientRect();
    const gap = 6;
    let top = side === 'bottom' ? r.bottom + gap : r.top - pr.height - gap;
    if (top + pr.height > window.innerHeight - 8) top = Math.max(8, r.top - pr.height - gap);
    let left =
      align === 'start'
        ? r.left
        : align === 'end'
          ? r.right - pr.width
          : r.left + r.width / 2 - pr.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - pr.width - 8));
    setStyle({ top, left, ...(matchWidth ? { minWidth: r.width } : {}) });
  };

  // place() reads live element geometry, so it is re-created every render on purpose; the
  // effects below own when it runs rather than a dependency array pretending it is stable.
  const placeRef = useRef(place);
  useLayoutEffect(() => {
    placeRef.current = place;
  });
  const runPlace = useCallback(() => {
    placeRef.current();
  }, []);

  useLayoutEffect(() => {
    if (open) runPlace();
  }, [open, runPlace]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) === true || anchor.current?.contains(t) === true) return;
      onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onOpenChange(false);
        anchor.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', runPlace);
    window.addEventListener('scroll', runPlace, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', runPlace);
      window.removeEventListener('scroll', runPlace, true);
    };
  }, [open, onOpenChange, runPlace, anchor]);

  if (!open) return null;
  return createPortal(
    <div
      ref={panel}
      aria-label={ariaLabel}
      style={{ top: style.top, left: style.left, minWidth: style.minWidth, width }}
      className={cn(
        'fade-in fixed z-[90] max-h-[70vh] overflow-y-auto rounded-md border border-border bg-raised p-1 shadow-float',
        className,
      )}
    >
      {children}
    </div>,
    document.body,
  );
}

export interface MenuItemDef {
  id: string;
  label: ReactNode;
  icon?: LucideIcon;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
  onSelect: () => void;
}

export interface DropdownMenuProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  anchor: RefObject<HTMLElement | null>;
  items: (MenuItemDef | 'separator')[];
  align?: 'start' | 'end';
  ariaLabel?: string;
}

export function DropdownMenu({
  open,
  onOpenChange,
  anchor,
  items,
  align = 'end',
  ariaLabel,
}: DropdownMenuProps) {
  const [active, setActive] = useState(0);
  const real = items.filter((i): i is MenuItemDef => i !== 'separator' && i.disabled !== true);

  useResetWhen(open, () => {
    if (!open) setActive(0);
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((a) => (a + 1) % real.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => (a - 1 + real.length) % real.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = real[active];
        if (item) {
          onOpenChange(false);
          item.onSelect();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [open, active, real, onOpenChange]);

  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      anchor={anchor}
      align={align}
      width={224}
      ariaLabel={ariaLabel}
    >
      <div role="menu" aria-label={ariaLabel}>
        {items.map((item, i) =>
          item === 'separator' ? (
            <div key={`sep-${String(i)}`} className="my-1 h-px bg-[var(--border)]" />
          ) : (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              title={item.title}
              onMouseEnter={() => {
                const idx = real.indexOf(item);
                if (idx >= 0) setActive(idx);
              }}
              onClick={() => {
                onOpenChange(false);
                item.onSelect();
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-base',
                item.danger === true ? 'text-danger' : 'text-text',
                item.disabled === true
                  ? 'cursor-not-allowed text-faint'
                  : real[active] === item
                    ? 'bg-hover'
                    : 'hover:bg-hover',
              )}
            >
              {item.icon !== undefined && <item.icon size={14} className="shrink-0" aria-hidden />}
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.shortcut !== undefined && (
                <span className="text-xs text-faint">{item.shortcut}</span>
              )}
            </button>
          ),
        )}
      </div>
    </Popover>
  );
}

export interface TabDef {
  id: string;
  label: ReactNode;
  count?: number;
  icon?: LucideIcon;
}

export function Tabs({
  tabs,
  value,
  onChange,
  className,
  ariaLabel,
}: {
  tabs: TabDef[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        'scrollbar-none flex gap-0.5 overflow-x-auto border-b border-border text-base',
        className,
      )}
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          onClick={() => {
            onChange(t.id);
          }}
          className={cn(
            '-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 whitespace-nowrap',
            value === t.id
              ? 'border-flare font-medium text-text'
              : 'border-transparent text-muted hover:text-text',
          )}
        >
          {t.icon !== undefined && <t.icon size={14} aria-hidden />}
          {t.label}
          {t.count !== undefined && <span className="text-xs text-faint">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
