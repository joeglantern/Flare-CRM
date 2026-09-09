/**
 * The whole manual on one page, for printing or saving as PDF (docs/22).
 *
 * Same content as the manual, no navigation, every chapter starting on a fresh page. It is
 * printed in light regardless of the reader's theme, because a dark page wastes ink and prints
 * grey; the figures follow suit.
 */
import { ArrowLeft, Printer } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { useMemo } from 'react';
import { Button } from '@/components/ui/Button';
import { usePageMeta } from '@/app/shell/page-meta';
import { useEntitlements } from '@/providers/entitlements';
import { useSettings } from '@/providers/settings';
import { formatDate } from '@/lib/format';
import { BlockView } from './blocks/Blocks';
import { groupChapters, visibleChapters } from './content';
import { useHelpAccess } from './HelpScreen';

export function HelpPrintScreen() {
  usePageMeta([{ label: 'Help', href: '/help' }, { label: 'Print' }]);
  const access = useHelpAccess();
  const entitlements = useEntitlements();
  const settings = useSettings();
  const chapters = useMemo(() => visibleChapters(access), [access]);
  const groups = useMemo(() => groupChapters(chapters), [chapters]);
  const today = formatDate(new Date().toISOString(), settings.timezone);

  return (
    <div className="p-6">
      <div className="no-print mb-5 flex items-center gap-2">
        <Link to="/help" className="no-underline">
          <Button variant="ghost" icon={ArrowLeft}>
            Back to the manual
          </Button>
        </Link>
        <Button
          variant="primary"
          icon={Printer}
          onClick={() => {
            window.print();
          }}
        >
          Print
        </Button>
        <span className="text-base text-muted">
          {chapters.length} chapters. Your browser's print dialog can save this as a PDF.
        </span>
      </div>

      {/* data-print-sheet forces a white ground and black text when printing (styles/app.css) */}
      <div data-print-sheet data-theme="light" className="mx-auto max-w-[820px]">
        <section className="mb-8 border-b border-border pb-8 text-center">
          <img src="/brand/mark.svg" alt="" width={40} height={40} className="mx-auto" />
          <h1 className="mt-3 text-3xl">Flare CRM</h1>
          <p className="mt-1 text-lg text-muted">User manual</p>
          <p className="mt-6 text-md">{entitlements.customerName}</p>
          <p className="text-base text-muted">
            {entitlements.plan.name} plan · {today}
          </p>
          <p className="mt-4 max-w-[60ch] mx-auto text-base text-muted">
            This manual covers the parts of the CRM included in your plan and available to your
            role. Anything not included has been left out rather than described and locked.
          </p>
        </section>

        <nav aria-label="Contents" className="mb-8">
          <h2 className="mb-2 text-xl">Contents</h2>
          {groups.map((g) => (
            <div key={g.group} className="mb-3">
              <div className="text-sm font-medium tracking-[0.04em] text-muted uppercase">
                {g.group}
              </div>
              <ol className="mt-1 flex flex-col gap-0.5">
                {g.chapters.map((c) => (
                  <li key={c.id} className="text-md">
                    {c.title}
                    <span className="text-muted"> — {c.summary}</span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </nav>

        {chapters.map((c) => (
          <article key={c.id} data-print-chapter className="mb-9">
            <h2 className="text-2xl">{c.title}</h2>
            <p className="mt-1 mb-4 text-md text-muted">{c.summary}</p>
            {c.sections.map((s) => (
              <section key={s.id} className="mb-6">
                <h3 className="mb-1 text-lg">{s.heading}</h3>
                {s.blocks.map((b, i) => (
                  <BlockView key={i} block={b} chapterId={c.id} />
                ))}
              </section>
            ))}
          </article>
        ))}
      </div>
    </div>
  );
}
