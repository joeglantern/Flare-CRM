/**
 * The manual (docs/22).
 *
 * Chapters on the left, the chapter you are reading in the middle, its sections on the right.
 * Everything is filtered to what the reader's plan and role actually include, so the manual never
 * explains a screen they cannot open. Search runs in the browser over the same content.
 */
import { ChevronLeft, ChevronRight, Printer, Search as SearchIcon } from 'lucide-react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { EmptyState, ForbiddenState, PlanLockedState } from '@/components/data/states';
import { PageHeader } from '@/app/shell/TopBar';
import { usePageMeta } from '@/app/shell/page-meta';
import { useSearchParam } from '@/lib/list-state';
import { useEntitlements } from '@/providers/entitlements';
import { usePermissions } from '@/providers/permissions';
import { cn } from '@/lib/utils';
import { BlockView } from './blocks/Blocks';
import { chapterById, groupChapters, visibleChapters, type Access } from './content';
import { buildIndex, search } from './search';

export function useHelpAccess(): Access {
  const perms = usePermissions();
  const { features } = useEntitlements();
  return useMemo(
    () => ({ has: (p) => perms.has(p), feature: (f) => features[f] }),
    [perms, features],
  );
}

export function HelpScreen() {
  usePageMeta([{ label: 'Help' }]);
  const access = useHelpAccess();
  const { ownerContact } = useEntitlements();
  const navigate = useNavigate();
  const [chapterId, setChapterId] = useSearchParam('chapter');
  const [sectionId] = useSearchParam('section');
  const [query, setQuery] = useSearchParam('q');
  const [draft, setDraft] = useState(query ?? '');
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const chapters = useMemo(() => visibleChapters(access), [access]);
  const groups = useMemo(() => groupChapters(chapters), [chapters]);
  const index = useMemo(() => buildIndex(chapters), [chapters]);
  const hits = useMemo(() => (query ? search(index, query, 12) : []), [index, query]);

  const current = chapters.find((c) => c.id === chapterId) ?? chapters[0];
  const position = current ? chapters.findIndex((c) => c.id === current.id) : -1;
  const previous = position > 0 ? chapters[position - 1] : undefined;
  const next = position >= 0 && position < chapters.length - 1 ? chapters[position + 1] : undefined;

  // Scroll to the requested section once the chapter is on screen.
  useEffect(() => {
    if (sectionId === undefined || !current) return;
    const el = document.getElementById(`section-${sectionId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [sectionId, current]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [chapterId]);

  // A chapter that exists but is hidden deserves an explanation rather than silently redirecting.
  const requested = chapterId !== undefined ? chapterById.get(chapterId) : undefined;
  const hiddenReason =
    requested !== undefined && !chapters.some((c) => c.id === requested.id)
      ? requested.feature !== undefined && !access.feature(requested.feature)
        ? ('feature' as const)
        : ('permission' as const)
      : null;

  return (
    <div className="flex flex-col gap-4 p-6">
      <PageHeader
        title="Help"
        description="How every part of the CRM works. Only what your plan and role include is shown."
        actions={
          <Link to="/help/print" className="no-underline">
            <Button variant="secondary" icon={Printer}>
              Print the manual
            </Button>
          </Link>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[230px_minmax(0,1fr)]">
        <nav
          aria-label="Manual chapters"
          className="flex flex-col gap-3 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-6rem)] lg:self-start lg:overflow-y-auto"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setQuery(draft.trim() === '' ? undefined : draft.trim());
            }}
          >
            <Input
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                const v = e.target.value.trim();
                setQuery(v.length >= 2 ? v : undefined);
              }}
              prefix={<SearchIcon size={14} aria-hidden />}
              placeholder="Search the manual"
              aria-label="Search the manual"
            />
          </form>

          {groups.map((g) => (
            <div key={g.group}>
              <div className="mb-1 px-1 text-xs font-medium tracking-[0.04em] text-muted uppercase">
                {g.group}
              </div>
              <div className="flex flex-col gap-0.5">
                {g.chapters.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    aria-current={c.id === current?.id ? 'page' : undefined}
                    onClick={() => {
                      setChapterId(c.id === chapters[0]?.id ? undefined : c.id);
                    }}
                    className={cn(
                      'flex h-8 items-center gap-2 rounded-sm px-2.5 text-left text-base',
                      c.id === current?.id
                        ? 'bg-[var(--flare-subtle)] font-medium text-flare-on'
                        : 'text-muted hover:bg-hover hover:text-text',
                    )}
                  >
                    <c.icon size={14} className="shrink-0" aria-hidden />
                    <span className="truncate">{c.title}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div ref={bodyRef} className="min-w-0">
          {query !== undefined && query.length >= 2 ? (
            <section aria-label="Search results">
              <h2 className="text-lg">
                {hits.length} {hits.length === 1 ? 'result' : 'results'} for “{query}”
              </h2>
              {hits.length === 0 ? (
                <div className="mt-4">
                  <EmptyState
                    object="magnifier"
                    title="Nothing in the manual matches that"
                    description="Try a word that would appear on the screen you are asking about, such as transfer, template or retention."
                  />
                </div>
              ) : (
                <ul className="mt-3 flex flex-col gap-1">
                  {hits.map((hit) => (
                    <li key={`${hit.chapterId}-${hit.sectionId}`}>
                      <button
                        type="button"
                        onClick={() => {
                          setDraft('');
                          void navigate({
                            to: '/help',
                            search: { chapter: hit.chapterId, section: hit.sectionId } as never,
                          });
                        }}
                        className="w-full rounded-md border border-border bg-surface px-3.5 py-2.5 text-left hover:bg-hover"
                      >
                        <div className="text-sm text-muted">{hit.chapterTitle}</div>
                        <div className="font-medium">{hit.heading}</div>
                        <p className="mt-0.5 line-clamp-2 text-base text-muted">{hit.snippet}</p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : hiddenReason === 'feature' && requested?.feature !== undefined ? (
            <PlanLockedState
              feature={requested.feature}
              what={requested.title}
              owner={ownerContact}
              showPlanLink={access.has('settings:read')}
            />
          ) : hiddenReason === 'permission' ? (
            <ForbiddenState
              {...(requested?.permission !== undefined ? { permission: requested.permission } : {})}
              what={requested?.title ?? 'this chapter'}
            />
          ) : current === undefined ? (
            <EmptyState object="folder" title="There is nothing to show here yet" />
          ) : (
            <article>
              <header className="mb-4">
                <h2 className="text-2xl">{current.title}</h2>
                <p className="mt-1 max-w-[68ch] text-md text-muted">{current.summary}</p>
              </header>

              {current.sections.length > 2 && (
                <nav aria-label="On this page" className="mb-5 rounded-md border border-border p-3">
                  <div className="mb-1.5 text-xs font-medium tracking-[0.04em] text-muted uppercase">
                    On this page
                  </div>
                  <ul className="flex flex-wrap gap-x-4 gap-y-1">
                    {current.sections.map((s) => (
                      <li key={s.id}>
                        <a
                          href={`#section-${s.id}`}
                          className="text-base no-underline hover:underline"
                        >
                          {s.heading}
                        </a>
                      </li>
                    ))}
                  </ul>
                </nav>
              )}

              {current.sections.map((s) => (
                <section key={s.id} id={`section-${s.id}`} className="mb-7 scroll-mt-4">
                  <h3 className="mb-1 text-lg">{s.heading}</h3>
                  {s.blocks.map((b, i) => (
                    <BlockView key={i} block={b} chapterId={current.id} />
                  ))}
                </section>
              ))}

              <nav
                aria-label="Chapter navigation"
                className="flex items-center justify-between gap-3 border-t border-border pt-4"
              >
                {previous ? (
                  <Button
                    variant="ghost"
                    icon={ChevronLeft}
                    onClick={() => {
                      setChapterId(previous.id === chapters[0]?.id ? undefined : previous.id);
                    }}
                  >
                    {previous.title}
                  </Button>
                ) : (
                  <span />
                )}
                {next && (
                  <Button
                    variant="ghost"
                    icon={ChevronRight}
                    iconPosition="end"
                    onClick={() => {
                      setChapterId(next.id);
                    }}
                  >
                    {next.title}
                  </Button>
                )}
              </nav>
            </article>
          )}
        </div>
      </div>
    </div>
  );
}
