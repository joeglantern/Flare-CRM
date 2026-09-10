/**
 * The frame the public legal documents sit in.
 *
 * These pages are read by three sorts of visitor: a customer deciding whether to trust us, a
 * person exercising a right over their own data, and a reviewer at Meta or a regulator checking
 * that the URL we gave them resolves to something real. All three want one column of readable
 * text, no product chrome, and no sign-in.
 */
import type { ReactNode } from 'react';
import { FlareWordmark } from '@/components/brand/Logo';
import { PROVIDER } from './provider';

export function LegalLayout({
  title,
  summary,
  children,
}: {
  title: string;
  summary: string;
  children: ReactNode;
}) {
  return (
    <main className="min-h-dvh bg-bg text-text">
      <div className="mx-auto w-full max-w-2xl px-6 py-12">
        <a href="/sign-in" className="inline-block">
          <FlareWordmark size={22} />
        </a>

        <h1 className="mt-10 text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-3 text-base text-muted">{summary}</p>
        <p className="mt-1 text-sm text-faint">Last updated {PROVIDER.updated}.</p>

        <div className="mt-10 flex flex-col gap-8">{children}</div>

        <footer className="mt-16 border-t border-border pt-6 text-sm text-muted">
          <nav className="flex flex-wrap gap-x-6 gap-y-2">
            <a href="/privacy" className="underline underline-offset-2 hover:text-text">
              Privacy
            </a>
            <a href="/terms" className="underline underline-offset-2 hover:text-text">
              Terms
            </a>
            <a href="/data-deletion" className="underline underline-offset-2 hover:text-text">
              Deleting your data
            </a>
            <a
              href={`mailto:${PROVIDER.email}`}
              className="underline underline-offset-2 hover:text-text"
            >
              {PROVIDER.email}
            </a>
          </nav>
          <p className="mt-4">
            {PROVIDER.legalName}, {PROVIDER.address.join(', ')}.
          </p>
        </footer>
      </div>
    </main>
  );
}

export function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">{heading}</h2>
      {children}
    </section>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <p className="text-base leading-relaxed text-muted">{children}</p>;
}

export function List({ items }: { items: ReactNode[] }) {
  return (
    <ul className="flex list-disc flex-col gap-2 pl-5 text-base leading-relaxed text-muted">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}
