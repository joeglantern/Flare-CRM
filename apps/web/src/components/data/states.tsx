/**
 * EmptyState, ErrorState, ForbiddenState, PlanLockedState and OfflineState (Component Inventory ·
 * Data display). Each names what is missing rather than offering a generic apology.
 * ForbiddenState always names the permission and PlanLockedState always names the feature and who
 * to ask, which is what makes them actionable.
 */
import { FEATURES, type FeatureKey } from '@crm/shared';
import { Lock, RefreshCw, ShieldAlert, WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

/** The 40 brand objects, used only in empty states and onboarding. */
export type BrandObjectName =
  | 'handset'
  | 'headset'
  | 'chat-bubble'
  | 'inbox-tray'
  | 'envelope'
  | 'calendar'
  | 'bell'
  | 'folder'
  | 'bar-chart'
  | 'funnel'
  | 'contact-card'
  | 'shield'
  | 'key'
  | 'magnifier'
  | 'upload'
  | 'spreadsheet'
  | 'chain'
  | 'unplugged'
  | 'clock'
  | 'checkmark'
  | 'warning'
  | 'paper-plane'
  | 'rotary'
  | 'sim'
  | 'soundwave'
  | 'cassette'
  | 'stopwatch'
  | 'kanban'
  | 'pipeline'
  | 'map-pin'
  | 'tag'
  | 'coins'
  | 'handshake'
  | 'trophy'
  | 'hourglass'
  | 'lock'
  | 'filter'
  | 'table'
  | 'pencil'
  | 'sparkline';

export function BrandObject({
  name,
  size = 96,
  className,
}: {
  name: BrandObjectName;
  size?: number;
  className?: string;
}) {
  // AVIF first, WebP next, PNG for anything that understands neither; all three are built from the
  // same master by scripts/build-brand-assets.mjs. The modern formats are about a tenth the size.
  const base = `/brand/objects/${name}`;
  return (
    <picture className={cn('shrink-0', className)} style={{ width: size, height: size }}>
      <source type="image/avif" srcSet={`${base}.avif`} />
      <source type="image/webp" srcSet={`${base}.webp`} />
      <img
        src={`${base}.png`}
        alt=""
        aria-hidden
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        className="h-full w-full object-contain"
      />
    </picture>
  );
}

export interface ActionProps {
  label: string;
  onClick?: () => void;
  href?: string;
  icon?: React.ComponentType<{ size?: number }>;
}

function ActionButton({
  action,
  variant,
}: {
  action: ActionProps;
  variant: 'primary' | 'secondary' | 'ghost';
}) {
  if (action.href !== undefined) {
    return (
      <Link to={action.href}>
        <Button variant={variant} icon={action.icon as never}>
          {action.label}
        </Button>
      </Link>
    );
  }
  return (
    <Button variant={variant} icon={action.icon as never} onClick={action.onClick}>
      {action.label}
    </Button>
  );
}

export interface EmptyStateProps {
  object: BrandObjectName;
  title: string;
  description?: string;
  primaryAction?: ActionProps;
  secondaryAction?: ActionProps;
  /** Compact renders the panel variant: 64px object, horizontal layout. */
  compact?: boolean;
  className?: string;
}

export function EmptyState({
  object,
  title,
  description,
  primaryAction,
  secondaryAction,
  compact = false,
  className,
}: EmptyStateProps) {
  if (compact) {
    return (
      <div className={cn('flex items-center gap-4 p-5', className)}>
        <BrandObject name={object} size={64} />
        <div className="min-w-0">
          <div className="font-medium">{title}</div>
          {description !== undefined && <div className="text-base text-muted">{description}</div>}
          {(primaryAction !== undefined || secondaryAction !== undefined) && (
            <div className="mt-2.5 flex flex-wrap gap-2">
              {primaryAction !== undefined && (
                <ActionButton action={primaryAction} variant="secondary" />
              )}
              {secondaryAction !== undefined && (
                <ActionButton action={secondaryAction} variant="ghost" />
              )}
            </div>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className={cn('flex flex-col items-center gap-2 px-6 py-10 text-center', className)}>
      <BrandObject name={object} size={96} />
      <div className="font-medium">{title}</div>
      {description !== undefined && (
        <p className="max-w-[320px] text-base text-muted">{description}</p>
      )}
      {(primaryAction !== undefined || secondaryAction !== undefined) && (
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {primaryAction !== undefined && <ActionButton action={primaryAction} variant="primary" />}
          {secondaryAction !== undefined && (
            <ActionButton action={secondaryAction} variant="secondary" />
          )}
        </div>
      )}
    </div>
  );
}

export interface ErrorStateProps {
  title?: string;
  message?: string;
  requestId?: string | null;
  onRetry?: () => void;
  compact?: boolean;
  className?: string;
}

export function ErrorState({
  title = 'Could not load this',
  message,
  requestId,
  onRetry,
  compact = false,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-3 rounded-md bg-[var(--danger-subtle)] p-4',
        compact ? '' : 'flex-col items-center py-8 text-center',
        className,
      )}
    >
      {!compact && <BrandObject name="warning" size={72} />}
      <div className={cn('min-w-0', compact ? 'flex-1' : '')}>
        <div className="font-medium">{title}</div>
        {message !== undefined && <p className="mt-0.5 text-base text-muted">{message}</p>}
        {requestId !== undefined && requestId !== null && (
          <p className="mono mt-1 text-xs text-faint">request {requestId}</p>
        )}
      </div>
      {onRetry !== undefined && (
        <Button
          variant="secondary"
          size="sm"
          icon={RefreshCw}
          onClick={onRetry}
          className={compact ? '' : 'mt-2'}
        >
          Retry
        </Button>
      )}
    </div>
  );
}

export interface ForbiddenStateProps {
  /** e.g. "report:view_team" — always named, that is what makes it actionable. */
  permission?: string;
  what?: string;
  backTo?: { label: string; href: string };
  compact?: boolean;
  className?: string;
}

export function ForbiddenState({
  permission,
  what,
  backTo,
  compact = false,
  className,
}: ForbiddenStateProps) {
  const title =
    what !== undefined ? `You do not have access to ${what}` : 'You do not have access to this';
  if (compact) {
    return (
      <div
        className={cn(
          'flex items-start gap-3 rounded-md border border-border bg-surface p-4',
          className,
        )}
      >
        <ShieldAlert size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden />
        <div className="min-w-0">
          <div className="font-medium">{title}</div>
          <p className="text-base text-muted">
            {permission !== undefined ? (
              <>
                Requires <span className="mono">{permission}</span>. Ask a manager or admin.
              </>
            ) : (
              'Ask a manager or admin.'
            )}
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className={cn('flex flex-col items-center gap-2 px-6 py-10 text-center', className)}>
      <BrandObject name="shield" size={96} />
      <div className="font-medium">{title}</div>
      <p className="max-w-[340px] text-base text-muted">
        {permission !== undefined ? (
          <>
            Requires <span className="mono">{permission}</span>. Ask a manager or admin.
          </>
        ) : (
          'Ask a manager or admin to grant access.'
        )}
      </p>
      {backTo !== undefined && (
        <Link to={backTo.href} className="mt-2">
          <Button variant="secondary">{backTo.label}</Button>
        </Link>
      )}
    </div>
  );
}

export function OfflineState({ onRetry, className }: { onRetry?: () => void; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center gap-2 px-6 py-10 text-center', className)}>
      <BrandObject name="unplugged" size={96} />
      <div className="font-medium">You are offline</div>
      <p className="max-w-[320px] text-base text-muted">
        This list will refresh by itself when the connection returns. Nothing you type is saved
        until then.
      </p>
      {onRetry !== undefined && (
        <Button variant="secondary" icon={WifiOff} onClick={onRetry} className="mt-2">
          Try again
        </Button>
      )}
    </div>
  );
}

/** Full-page 404, kept in the same family so the visual language matches. */
export function NotFoundState({
  what = 'page',
  backTo,
}: {
  what?: string;
  backTo?: { label: string; href: string };
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
      <BrandObject name="magnifier" size={96} />
      <div className="font-medium">That {what} does not exist</div>
      <p className="max-w-[320px] text-base text-muted">
        It may have been deleted, or the link may be wrong.
      </p>
      {backTo !== undefined && (
        <Link to={backTo.href} className="mt-2">
          <Button variant="secondary">{backTo.label}</Button>
        </Link>
      )}
    </div>
  );
}

export type ViewState =
  'loading' | 'ready' | 'empty' | 'error' | 'forbidden' | 'locked' | 'offline';

/**
 * Renders the four non-ready states in a consistent way; `ready` and `loading` are the caller's
 * business because only they know the shape to skeleton.
 */
export interface PlanLockedStateProps {
  feature: FeatureKey;
  /** What the person was trying to reach, when it is narrower than the feature itself. */
  what?: string;
  owner?: { name: string; email: string; phone?: string };
  /** Only shown to someone who can actually open the plan page. */
  showPlanLink?: boolean;
  compact?: boolean;
  className?: string;
}

/**
 * The feature exists and the person's role allows it, but the customer's plan does not include
 * it (docs/20). Distinct from ForbiddenState, which is about the role: this one names the
 * feature and who to talk to, and offers nothing that would fail if clicked.
 */
export function PlanLockedState({
  feature,
  what,
  owner,
  showPlanLink = false,
  compact = false,
  className,
}: PlanLockedStateProps) {
  const { label, description } = FEATURES[feature];
  const title = `${label} is not part of your plan`;
  const contact =
    owner === undefined ? null : (
      <>
        {' '}
        To add it, contact {owner.name} at{' '}
        <a href={`mailto:${owner.email}`} className="whitespace-nowrap">
          {owner.email}
        </a>
        {owner.phone !== undefined && (
          <>
            {' '}
            or{' '}
            <a href={`tel:${owner.phone}`} className="whitespace-nowrap">
              {owner.phone}
            </a>
          </>
        )}
        .
      </>
    );
  if (compact) {
    return (
      <div
        className={cn(
          'flex items-start gap-3 rounded-md border border-border bg-surface p-4',
          className,
        )}
      >
        <Lock size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden />
        <div className="min-w-0">
          <div className="font-medium">{title}</div>
          <p className="text-base text-muted">
            {description}
            {contact}
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className={cn('flex flex-col items-center gap-2 px-6 py-10 text-center', className)}>
      <BrandObject name="lock" size={96} />
      <div className="font-medium">{what !== undefined ? `${what} is not available` : title}</div>
      <p className="max-w-[360px] text-base text-muted">
        {description}
        {contact}
      </p>
      {showPlanLink && (
        <a href="/settings?section=plan" className="text-base">
          See your plan
        </a>
      )}
    </div>
  );
}

export function StateSlot({
  state,
  empty,
  error,
  forbidden,
  locked,
  onRetry,
  compact,
}: {
  state: Exclude<ViewState, 'loading' | 'ready'>;
  empty?: EmptyStateProps;
  error?: { message?: string; requestId?: string | null };
  forbidden?: ForbiddenStateProps;
  locked?: PlanLockedStateProps;
  onRetry?: () => void;
  compact?: boolean;
}): ReactNode {
  if (state === 'empty' && empty !== undefined) return <EmptyState {...empty} compact={compact} />;
  if (state === 'forbidden') return <ForbiddenState {...forbidden} compact={compact} />;
  if (state === 'locked' && locked !== undefined)
    return <PlanLockedState {...locked} compact={compact} />;
  if (state === 'offline') return <OfflineState {...(onRetry !== undefined ? { onRetry } : {})} />;
  return (
    <ErrorState
      {...(error?.message !== undefined ? { message: error.message } : {})}
      {...(error?.requestId !== undefined ? { requestId: error.requestId } : {})}
      {...(onRetry !== undefined ? { onRetry } : {})}
      compact={compact ?? false}
    />
  );
}
