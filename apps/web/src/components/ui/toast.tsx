/**
 * ToastHost and the imperative toast() API (Component Inventory · App shell).
 * aria-live polite, with an optional action such as "Call back". The store lives outside React so
 * any module (socket handlers, mutations) can raise a toast without a hook.
 */
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { Button, IconButton } from './Button';

export type ToastTone = 'neutral' | 'success' | 'warning' | 'danger';

export interface ToastInput {
  tone?: ToastTone;
  title: string;
  description?: ReactNode;
  action?: { label: string; onClick: () => void };
  /** ms; 0 keeps it until dismissed. */
  duration?: number;
  /** Replaces an existing toast with the same key instead of stacking. */
  key?: string;
}

interface ToastItem extends Required<Pick<ToastInput, 'tone' | 'title'>> {
  id: number;
  description?: ReactNode;
  action?: { label: string; onClick: () => void };
  duration: number;
  key?: string;
}

let items: ToastItem[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

export function toast(input: ToastInput): number {
  const id = ++seq;
  const item: ToastItem = {
    id,
    tone: input.tone ?? 'neutral',
    title: input.title,
    duration: input.duration ?? (input.tone === 'danger' ? 8000 : 5000),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.action !== undefined ? { action: input.action } : {}),
    ...(input.key !== undefined ? { key: input.key } : {}),
  };
  items = [
    ...(input.key !== undefined ? items.filter((t) => t.key !== input.key) : items),
    item,
  ].slice(-4);
  emit();
  return id;
}

export const dismissToast = (id: number): void => {
  items = items.filter((t) => t.id !== id);
  emit();
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => items;

const ICON: Record<ToastTone, typeof Info> = {
  neutral: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
};
const COLOR: Record<ToastTone, string> = {
  neutral: 'text-muted',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
};

function Toast({ item }: { item: ToastItem }) {
  useEffect(() => {
    if (item.duration === 0) return;
    const t = setTimeout(() => {
      dismissToast(item.id);
    }, item.duration);
    return () => {
      clearTimeout(t);
    };
  }, [item.id, item.duration]);
  const Icon = ICON[item.tone];
  return (
    <div className="slide-up flex w-[360px] max-w-[calc(100vw-2rem)] items-start gap-2.5 rounded-md border border-border bg-raised p-3 text-base shadow-float">
      <Icon size={16} className={cn('mt-px shrink-0', COLOR[item.tone])} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{item.title}</div>
        {item.description !== undefined && (
          <div className="text-sm text-muted">{item.description}</div>
        )}
      </div>
      {item.action !== undefined && (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            dismissToast(item.id);
            item.action?.onClick();
          }}
        >
          {item.action.label}
        </Button>
      )}
      <IconButton
        icon={X}
        label="Dismiss"
        variant="ghost"
        size={26}
        onClick={() => {
          dismissToast(item.id);
        }}
      />
    </div>
  );
}

export function ToastHost() {
  const list = useSyncExternalStore(subscribe, snapshot, snapshot);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed right-4 bottom-4 z-[95] flex flex-col items-end gap-2"
    >
      {list.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <Toast item={t} />
        </div>
      ))}
    </div>,
    document.body,
  );
}
