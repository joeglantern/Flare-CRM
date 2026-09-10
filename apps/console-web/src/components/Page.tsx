/**
 * Page furniture: the header every screen starts with, and the three states a screen can be in
 * before it has data. Deliberately small; the console is a handful of tables and forms.
 */
import { AlertTriangle, Inbox, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button, cn, Spinner } from '@crm/ui';
import { errorMessage } from '@/lib/errors';

export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
      <div className="min-w-0">
        {back !== undefined && <div className="mb-1 text-sm text-muted">{back}</div>}
        <h1 className="truncate text-xl font-semibold">{title}</h1>
        {description !== undefined && <p className="mt-1 text-base text-muted">{description}</p>}
      </div>
      {actions !== undefined && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-md border border-border bg-surface', className)}>
      {(title !== undefined || actions !== undefined) && (
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0">
            {title !== undefined && <h2 className="text-md font-medium">{title}</h2>}
            {description !== undefined && (
              <p className="mt-0.5 text-sm text-muted">{description}</p>
            )}
          </div>
          {actions !== undefined && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-2 px-4 py-10 text-base text-muted"
    >
      <Spinner />
      {label}
    </div>
  );
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
      <Icon size={20} className="text-faint" aria-hidden />
      <p className="text-md font-medium">{title}</p>
      {description !== undefined && <p className="max-w-sm text-base text-muted">{description}</p>}
      {action !== undefined && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 px-4 py-12 text-center">
      <AlertTriangle size={20} className="text-danger" aria-hidden />
      <p className="text-md font-medium">That did not load</p>
      <p className="max-w-md text-base text-muted">{errorMessage(error)}</p>
      {onRetry !== undefined && (
        <Button className="mt-2" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/**
 * The one place a screen decides between loading, failed and loaded. Keeping it here means no
 * screen renders a table with `data ?? []` and shows an empty table when the request failed.
 */
export function StateSlot({
  isPending,
  error,
  isEmpty,
  empty,
  onRetry,
  children,
}: {
  isPending: boolean;
  error: unknown;
  isEmpty?: boolean;
  empty?: ReactNode;
  onRetry?: () => void;
  children: ReactNode;
}) {
  if (isPending) return <LoadingState />;
  if (error !== null && error !== undefined) {
    return <ErrorState error={error} {...(onRetry !== undefined ? { onRetry } : {})} />;
  }
  if (isEmpty === true && empty !== undefined) return <>{empty}</>;
  return <>{children}</>;
}
