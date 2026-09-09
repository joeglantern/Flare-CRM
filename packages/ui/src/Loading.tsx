/**
 * Spinner and Skeleton (Component Inventory · Primitives).
 * Design system rule: never a spinner for lists — skeletons mirror the final layout, same row
 * height, same column widths. Spinners only live inside buttons and small inline slots.
 */
import { Loader } from 'lucide-react';
import { cn } from './utils.js';

export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return <Loader size={size} className={cn('spin shrink-0', className)} aria-hidden />;
}

export interface SkeletonProps {
  width?: string | number;
  height?: number;
  shape?: 'line' | 'circle' | 'block';
  count?: number;
  className?: string;
}

export function Skeleton({ width, height, shape = 'line', count = 1, className }: SkeletonProps) {
  const h = height ?? (shape === 'line' ? 12 : shape === 'circle' ? 24 : 48);
  const w = width ?? (shape === 'circle' ? h : '100%');
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          aria-hidden
          style={{ width: w, height: h }}
          className={cn(
            'skeleton block',
            shape === 'circle' && 'rounded-full',
            shape === 'block' && 'rounded-md',
            className,
          )}
        />
      ))}
    </>
  );
}

/** Announces a busy region to assistive tech while skeletons are showing. */
export function LoadingRegion({ label = 'Loading' }: { label?: string }) {
  return (
    <span role="status" aria-live="polite" className="sr-only">
      {label}
    </span>
  );
}
