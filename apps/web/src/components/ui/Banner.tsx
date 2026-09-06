/**
 * Banner (Component Inventory · App shell): full-width alert for offline, PBX down, WhatsApp down
 * and maintenance. `meta` carries the socket event name so the state is traceable in the UI.
 */
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Button } from './Button';

export interface BannerProps {
  tone: 'warning' | 'danger' | 'info' | 'flare';
  icon: LucideIcon;
  children: ReactNode;
  action?: { label: string; onClick: () => void };
  meta?: string;
  className?: string;
}

const TONE: Record<BannerProps['tone'], { bg: string; icon: string }> = {
  warning: { bg: 'bg-[var(--warning-subtle)]', icon: 'text-warning' },
  danger: { bg: 'bg-[var(--danger-subtle)]', icon: 'text-danger' },
  info: { bg: 'bg-[var(--info-subtle)]', icon: 'text-info' },
  flare: { bg: 'bg-[var(--flare-subtle)]', icon: 'text-flare-on' },
};

export function Banner({ tone, icon: Icon, children, action, meta, className }: BannerProps) {
  return (
    <div
      role="status"
      className={cn(
        'flex items-center gap-2.5 px-4 py-2 text-base text-text',
        TONE[tone].bg,
        className,
      )}
    >
      <Icon size={14} className={cn('shrink-0', TONE[tone].icon)} aria-hidden />
      <span className="min-w-0 flex-1">{children}</span>
      {meta !== undefined && (
        <span className="mono hidden shrink-0 text-xs text-muted sm:inline">{meta}</span>
      )}
      {action !== undefined && (
        <Button size="sm" variant="secondary" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
