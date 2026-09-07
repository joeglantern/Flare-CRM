/**
 * The frame every signed-out screen sits in (Auth). Form on the left, product hero on the
 * right, and the hero drops away below the large breakpoint rather than squashing the form.
 *
 * The hero image is decorative, so it carries no alt text and never blocks the form: it is loaded
 * lazily and the layout does not move when it arrives.
 *
 * It is also positioned absolutely rather than laid out in the grid. The source is portrait, so in
 * flow its aspect ratio drove the row height and made the page taller than the viewport. The form
 * column then centred itself against that taller row and sat well below the middle of the screen,
 * which read as a large gap above the wordmark.
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
          className="absolute inset-0 h-full w-full object-cover"
        />
        {/*
         * The mark sits centre right in both the dark and light crops, leaving the upper left flat
         * and quiet. Putting the line there means it is read first, never crosses the subject, and
         * sets up a diagonal against it. That region is near black in one theme and near white in
         * the other, and the text colour flips with the theme, so it stays legible without a scrim
         * dimming the artwork. The narrow measure wraps it to two lines and keeps it clear of the
         * mark at every width the panel is shown at.
         */}
        <p className="absolute top-10 left-10 max-w-[16ch] text-2xl leading-snug font-medium tracking-tight text-balance">
          Every call, every deal, one screen.
        </p>
      </aside>
    </main>
  );
}
