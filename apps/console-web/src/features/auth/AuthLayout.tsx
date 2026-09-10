/**
 * The frame the signed-out screens sit in. One centred column: the console is a tool for two
 * people, so it gets none of the product's marketing furniture.
 */
import { KeyRound } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@crm/ui';

export function AuthLayout({
  title,
  description,
  children,
  footer,
  wide = false,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg p-6 text-text">
      <div className={cn('w-full', wide ? 'max-w-md' : 'max-w-sm')}>
        <span className="flex items-center gap-2 text-md font-semibold tracking-tight">
          <KeyRound size={16} className="text-flare" aria-hidden />
          Flare Console
        </span>

        <h1 className="mt-8 text-2xl font-semibold">{title}</h1>
        {description !== undefined && (
          <div className="mt-2 text-base text-muted">{description}</div>
        )}

        <div className="mt-6">{children}</div>

        {footer !== undefined && <div className="mt-6 text-sm text-muted">{footer}</div>}
      </div>
    </main>
  );
}
