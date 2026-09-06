/**
 * Overlay shells (Component Inventory · App shell): Dialog, Drawer and the focus/scroll plumbing
 * they share. Right-hand drawer for forms, centred dialog for confirmations and short forms.
 */
/*
 * Every keydown handler below sits on a focus-trapped role="dialog" panel. Handling Escape and
 * cycling Tab there is the WAI-ARIA modal pattern, which this rule does not model.
 */
/* eslint-disable jsx-a11y/no-noninteractive-element-interactions */
import { X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { IconButton } from './Button';

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Locks body scroll while any overlay is open (reference counted for stacked overlays). */
let lockCount = 0;
function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    if (lockCount === 0) {
      const width = window.innerWidth - document.documentElement.clientWidth;
      document.body.style.overflow = 'hidden';
      if (width > 0) document.body.style.paddingRight = `${String(width)}px`;
    }
    lockCount++;
    return () => {
      lockCount--;
      if (lockCount === 0) {
        document.body.style.overflow = '';
        document.body.style.paddingRight = '';
      }
    };
  }, [active]);
}

interface ShellProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title?: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  /** Esc and backdrop clicks are ignored while a submit is in flight. */
  dismissable?: boolean;
  className?: string;
  initialFocus?: boolean;
}

function useOverlay(
  open: boolean,
  onOpenChange: (v: boolean) => void,
  dismissable: boolean,
  focus: boolean,
) {
  const panel = useRef<HTMLDivElement | null>(null);
  const restore = useRef<HTMLElement | null>(null);
  useScrollLock(open);

  useEffect(() => {
    if (!open) return;
    restore.current = document.activeElement as HTMLElement | null;
    if (focus) {
      const t = setTimeout(() => {
        const el = panel.current?.querySelector<HTMLElement>(FOCUSABLE);
        (el ?? panel.current)?.focus();
      }, 0);
      return () => {
        clearTimeout(t);
        restore.current?.focus();
      };
    }
    return () => {
      restore.current?.focus();
    };
  }, [open, focus]);

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape' && dismissable) {
        e.stopPropagation();
        onOpenChange(false);
        return;
      }
      if (e.key !== 'Tab' || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null,
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [dismissable, onOpenChange],
  );

  return { panel, onKeyDown };
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  footer,
  children,
  dismissable = true,
  className,
  initialFocus = true,
  width = 480,
}: ShellProps & { width?: number }) {
  const id = useId();
  const { panel, onKeyDown } = useOverlay(open, onOpenChange, dismissable, initialFocus);
  if (!open) return null;
  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[10vh] backdrop-blur-[1px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && dismissable) onOpenChange(false);
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title !== undefined ? `${id}-t` : undefined}
        aria-describedby={description !== undefined ? `${id}-d` : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        style={{ width }}
        className={cn(
          'slide-up flex max-h-[80vh] w-full flex-col rounded-lg border border-border bg-raised shadow-float outline-none',
          className,
        )}
      >
        {title !== undefined && (
          <div className="flex items-start gap-3 px-5 pt-5">
            <div className="min-w-0 flex-1">
              <h2 id={`${id}-t`} className="text-xl">
                {title}
              </h2>
              {description !== undefined && (
                <p id={`${id}-d`} className="mt-1.5 text-base text-muted">
                  {description}
                </p>
              )}
            </div>
            {dismissable && (
              <IconButton
                icon={X}
                label="Close"
                variant="ghost"
                onClick={() => {
                  onOpenChange(false);
                }}
              />
            )}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer !== undefined && (
          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  footer,
  children,
  dismissable = true,
  className,
  initialFocus = true,
  width = 520,
}: ShellProps & { width?: number }) {
  const id = useId();
  const { panel, onKeyDown } = useOverlay(open, onOpenChange, dismissable, initialFocus);
  if (!open) return null;
  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 z-[80] flex justify-end bg-black/60"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && dismissable) onOpenChange(false);
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title !== undefined ? `${id}-t` : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        style={{ width: `min(${String(width)}px, 100vw)` }}
        className={cn(
          'flex h-full flex-col border-l border-border bg-raised outline-none',
          'motion-safe:animate-[flare-fade_var(--dur-panel)_var(--ease-out)]',
          className,
        )}
      >
        <div className="flex items-start gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id={`${id}-t`} className="text-lg">
              {title}
            </h2>
            {description !== undefined && <p className="mt-1 text-sm text-muted">{description}</p>}
          </div>
          <IconButton
            icon={X}
            label="Close"
            variant="ghost"
            onClick={() => {
              onOpenChange(false);
            }}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer !== undefined && (
          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Bottom sheet used for the mobile variants of the popup, filters and detail panes. */
export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  footer,
  className,
}: Omit<ShellProps, 'description' | 'dismissable' | 'initialFocus'>) {
  const { panel, onKeyDown } = useOverlay(open, onOpenChange, true, true);
  if (!open) return null;
  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 z-[80] flex items-end bg-black/60"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={cn(
          'slide-up flex max-h-[85vh] w-full flex-col rounded-t-lg border-t border-border bg-raised outline-none',
          className,
        )}
      >
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <h2 className="min-w-0 flex-1 text-lg">{title}</h2>
          <IconButton
            icon={X}
            label="Close"
            variant="ghost"
            onClick={() => {
              onOpenChange(false);
            }}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
        {footer !== undefined && <div className="border-t border-border px-4 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
