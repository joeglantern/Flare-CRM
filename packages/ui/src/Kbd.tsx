import type { ReactNode } from 'react';
import { cn } from './utils.js';

/** Keyboard key hint (Component Inventory · Primitives). */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-strong px-1.5',
        'font-sans text-xs leading-none text-muted',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/** Renders a shortcut string like "Ctrl+K" or "?" as separate keys. */
export function Shortcut({ keys, className }: { keys: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      {keys.split('+').map((k) => (
        <Kbd key={k}>{k}</Kbd>
      ))}
    </span>
  );
}
