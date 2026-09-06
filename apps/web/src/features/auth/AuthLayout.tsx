/**
 * The frame every signed-out screen sits in (Auth). Form on the left, product hero on the
 * right, and the hero drops away below the large breakpoint rather than squashing the form.
 *
 * The hero image is decorative, so it carries no alt text and never blocks the form: it is loaded
 * lazily and the layout does not move when it arrives.
 */
import type { ReactNode } from 'react';
import { FlareWordmark } from '@/components/brand/Logo';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

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
  const resolved = useTheme((s) => s.resolved);

  return (
    <main className="grid min-h-dvh bg-bg text-text lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex items-center justify-center p-6">
        <div className={cn('w-full', wide ? 'max-w-md' : 'max-w-sm')}>
          <FlareWordmark size={22} />

          <h1 className="mt-8 text-2xl font-semibold">{title}</h1>
          {description !== undefined && (
            <div className="mt-2 text-base text-muted">{description}</div>
          )}

          <div className="mt-6">{children}</div>

          {footer !== undefined && <div className="mt-6 text-sm text-muted">{footer}</div>}
        </div>
      </div>

      <aside className="relative hidden items-center justify-center overflow-hidden border-l border-border bg-surface lg:flex">
        <img
          src={resolved === 'light' ? '/brand/hero-light.png' : '/brand/hero-dark.png'}
          alt=""
          aria-hidden
          loading="lazy"
          className="h-full w-full object-cover"
        />
        <div className="absolute bottom-8 left-8 right-8">
          <p className="text-lg font-medium">Every call, every deal, one screen.</p>
          <p className="mt-1 text-base text-muted">
            Flare connects your Yeastar PBX to the people behind the numbers.
          </p>
        </div>
      </aside>
    </main>
  );
}
