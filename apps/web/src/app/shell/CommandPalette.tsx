/**
 * GlobalSearch + CommandPalette (Component Inventory · App shell). One surface: typing searches
 * contacts, companies, deals and leads (fanned out — see GAP-13 in features/search/api.ts) and
 * matches quick actions. A query that parses as a phone number offers Call as the first action.
 * Actions are filtered by permission so an agent never sees a command that 403s.
 */
import {
  Building2,
  Contact,
  FileSpreadsheet,
  Inbox,
  Kanban,
  LayoutDashboard,
  Phone,
  Search,
  Settings,
  SquareCheck,
  Target,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useResetWhen } from '@/lib/hooks';
import { createPortal } from 'react-dom';
import type { Permission } from '@crm/shared';
import { Avatar } from '@/components/ui/Avatar';
import { Kbd } from '@/components/ui/Kbd';
import { Spinner } from '@/components/ui/Loading';
import { useGlobalSearch, type SearchHit } from '@/features/search/api';
import { useDialer } from '@/features/telephony/dialer';
import { formatPhone } from '@/lib/format';
import { usePermissions } from '@/providers/permissions';
import { useSettings } from '@/providers/settings';
import { cn } from '@/lib/utils';

export interface Command {
  id: string;
  label: string;
  icon: LucideIcon;
  keywords: string;
  permission?: Permission;
  meta?: string;
  run: () => void;
}

type Row =
  | { kind: 'header'; id: string; label: string }
  | { kind: 'hit'; id: string; hit: SearchHit }
  | { kind: 'command'; id: string; command: Command };

export function CommandPalette({
  open,
  onOpenChange,
  initialQuery = '',
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialQuery?: string;
}) {
  const navigate = useNavigate();
  const perms = usePermissions();
  const settings = useSettings();
  const dialer = useDialer();
  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  useResetWhen(open ? initialQuery : null, () => {
    if (!open) return;
    setQuery(initialQuery);
    setActive(0);
  });

  const search = useGlobalSearch(query, settings.defaultCountry);

  const commands = useMemo<Command[]>(() => {
    const go = (to: string) => () => {
      onOpenChange(false);
      void navigate({ to });
    };
    const base: Command[] = [
      {
        id: 'go-home',
        label: 'Go to Home',
        icon: LayoutDashboard,
        keywords: 'home dashboard',
        run: go('/home'),
      },
      {
        id: 'go-contacts',
        label: 'Go to Contacts',
        icon: Contact,
        keywords: 'contacts people',
        permission: 'contact:read',
        run: go('/contacts'),
      },
      {
        id: 'go-companies',
        label: 'Go to Companies',
        icon: Building2,
        keywords: 'companies accounts',
        permission: 'company:read',
        run: go('/companies'),
      },
      {
        id: 'go-leads',
        label: 'Go to Leads',
        icon: Target,
        keywords: 'leads enquiries',
        permission: 'lead:read',
        run: go('/leads'),
      },
      {
        id: 'go-deals',
        label: 'Go to Deals',
        icon: Kanban,
        keywords: 'deals pipeline board',
        permission: 'deal:read',
        run: go('/deals'),
      },
      {
        id: 'go-tasks',
        label: 'Go to Tasks',
        icon: SquareCheck,
        keywords: 'tasks todo',
        permission: 'task:read',
        run: go('/tasks'),
      },
      {
        id: 'go-calls',
        label: 'Go to Calls',
        icon: Phone,
        keywords: 'calls history',
        permission: 'call:read',
        run: go('/calls'),
      },
      {
        id: 'go-missed',
        label: 'Go to Missed calls',
        icon: Phone,
        keywords: 'missed callback',
        permission: 'call:read',
        run: go('/calls/missed'),
      },
      {
        id: 'go-inbox',
        label: 'Go to Inbox',
        icon: Inbox,
        keywords: 'inbox whatsapp messages',
        permission: 'chat:read',
        run: go('/inbox'),
      },
      {
        id: 'go-imports',
        label: 'Go to Imports',
        icon: FileSpreadsheet,
        keywords: 'import csv',
        permission: 'contact:import',
        run: go('/imports'),
      },
      {
        id: 'go-settings',
        label: 'Go to Settings',
        icon: Settings,
        keywords: 'settings admin',
        permission: 'settings:read',
        run: go('/settings'),
      },
      {
        id: 'new-contact',
        label: query.trim() === '' ? 'New contact' : `New contact “${query.trim()}”`,
        icon: UserPlus,
        keywords: 'create contact new',
        permission: 'contact:create',
        run: () => {
          onOpenChange(false);
          void navigate({ to: '/contacts', search: { create: query.trim() || true } as never });
        },
      },
      {
        id: 'new-task',
        label: 'New task',
        icon: SquareCheck,
        keywords: 'create task new',
        permission: 'task:create',
        run: () => {
          onOpenChange(false);
          void navigate({ to: '/tasks', search: { create: true } as never });
        },
      },
      {
        id: 'new-deal',
        label: 'New deal',
        icon: Kanban,
        keywords: 'create deal new',
        permission: 'deal:create',
        run: () => {
          onOpenChange(false);
          void navigate({ to: '/deals', search: { create: true } as never });
        },
      },
    ];
    return base.filter((c) => c.permission === undefined || perms.has(c.permission));
  }, [navigate, onOpenChange, perms, query]);

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const out: Row[] = [];

    const dialNumber = search.data?.dialable ?? null;
    if (dialNumber !== null && dialer.canDial) {
      out.push({ kind: 'header', id: 'h-dial', label: 'Call' });
      out.push({
        kind: 'command',
        id: 'dial-typed',
        command: {
          id: 'dial-typed',
          label: `Call ${formatPhone(dialNumber)}`,
          icon: Phone,
          keywords: 'call dial',
          meta: dialNumber,
          run: () => {
            onOpenChange(false);
            dialer.dial({ e164: dialNumber });
          },
        },
      });
    }

    for (const g of search.data?.groups ?? []) {
      out.push({ kind: 'header', id: `h-${g.kind}`, label: g.label });
      for (const hit of g.hits) out.push({ kind: 'hit', id: `${g.kind}-${hit.id}`, hit });
    }

    const matched =
      q === ''
        ? commands.slice(0, 8)
        : commands.filter((c) => `${c.label} ${c.keywords}`.toLowerCase().includes(q));
    if (matched.length > 0) {
      out.push({ kind: 'header', id: 'h-actions', label: 'Actions' });
      for (const c of matched.slice(0, 8)) out.push({ kind: 'command', id: c.id, command: c });
    }
    return out;
  }, [commands, query, search.data, dialer, onOpenChange]);

  const selectable = rows.filter((r) => r.kind !== 'header');

  useResetWhen(rows, () => {
    setActive(0);
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onOpenChange(false);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((a) => Math.min(a + 1, selectable.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const row = selectable[active];
        if (!row) return;
        if (row.kind === 'command') row.command.run();
        else {
          onOpenChange(false);
          void navigate({ to: row.hit.href });
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [open, active, selectable, navigate, onOpenChange]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  let index = -1;
  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 z-[85] flex items-start justify-center bg-black/60 p-4 pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search and commands"
        className="slide-up flex max-h-[70vh] w-full max-w-[560px] flex-col rounded-lg border border-border bg-raised shadow-float"
      >
        <div className="flex items-center gap-2.5 border-b border-border px-3.5 py-2.5">
          <Search size={16} className="shrink-0 text-muted" aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
            placeholder="Search contacts, companies, deals, leads, numbers…"
            aria-label="Search"
            className="h-6 w-full bg-transparent text-md outline-none placeholder:text-faint"
          />
          {search.isFetching && <Spinner />}
          <Kbd>Esc</Kbd>
        </div>

        <div
          ref={listRef}
          className="min-h-0 flex-1 overflow-y-auto p-1.5"
          role="listbox"
          aria-label="Results"
        >
          {rows.length === 0 && (
            <div className="px-3 py-8 text-center text-base text-muted">
              {query.trim().length < 2
                ? 'Type at least two characters.'
                : 'No results. Try a name, company or number.'}
            </div>
          )}
          {rows.map((row) => {
            if (row.kind === 'header') {
              return (
                <div
                  key={row.id}
                  className="px-2.5 pt-2 pb-1 text-xs tracking-[0.04em] text-faint uppercase"
                >
                  {row.label}
                </div>
              );
            }
            index++;
            const isActive = index === active;
            const common = cn(
              'flex w-full items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-left text-base',
              isActive ? 'bg-hover' : 'hover:bg-hover',
            );
            if (row.kind === 'hit') {
              const h = row.hit;
              return (
                <button
                  key={row.id}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  data-active={isActive}
                  className={common}
                  onMouseEnter={() => {
                    setActive(index);
                  }}
                  onClick={() => {
                    onOpenChange(false);
                    void navigate({ to: h.href });
                  }}
                >
                  {h.kind === 'contacts' || h.kind === 'leads' ? (
                    <Avatar name={h.title} seed={h.id} src={h.avatarUrl} size={20} />
                  ) : (
                    <span className="flex h-5 w-5 items-center justify-center text-muted">
                      {h.kind === 'companies' ? (
                        <Building2 size={14} aria-hidden />
                      ) : (
                        <Kanban size={14} aria-hidden />
                      )}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate font-medium">{h.title}</span>
                  {h.subtitle != null && (
                    <span className="hidden min-w-0 truncate text-muted sm:block">
                      {h.subtitle}
                    </span>
                  )}
                  {h.meta != null && (
                    <span className="mono shrink-0 text-sm text-muted">{h.meta}</span>
                  )}
                  {isActive && <Kbd>↵</Kbd>}
                </button>
              );
            }
            const c = row.command;
            return (
              <button
                key={row.id}
                type="button"
                role="option"
                aria-selected={isActive}
                data-active={isActive}
                className={common}
                onMouseEnter={() => {
                  setActive(index);
                }}
                onClick={c.run}
              >
                <c.icon size={16} className="shrink-0 text-muted" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{c.label}</span>
                {c.meta !== undefined && (
                  <span className="mono shrink-0 text-xs text-faint">{c.meta}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
