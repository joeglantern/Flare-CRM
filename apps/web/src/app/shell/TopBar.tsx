/**
 * TopBar (Component Inventory · App shell): breadcrumb, global search, notification bell,
 * presence and extension chip, theme toggle, user menu.
 */
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import {
  ChevronRight,
  CircleHelp,
  Keyboard,
  LogOut,
  Menu,
  Moon,
  Search,
  Settings,
  Sun,
  User,
  type LucideIcon,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Button, IconButton } from '@/components/ui/Button';
import { Kbd } from '@/components/ui/Kbd';
import { DropdownMenu } from '@/components/ui/Menu';
import { Tooltip } from '@/components/ui/Tooltip';
import { authClient } from '@/lib/auth/client';
import { useMe } from '@/lib/auth/me';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { chapterForPath } from '@/features/help/context';
import { NotificationBell } from './NotificationBell';
import { usePageMetaStore } from './page-meta';

export interface PresenceState {
  tone: 'available' | 'ringing' | 'on_call' | 'offline';
  label: string;
}

export function TopBar({
  presence,
  onOpenSearch,
  onOpenShortcuts,
  onOpenNav,
}: {
  presence: PresenceState;
  onOpenSearch: () => void;
  onOpenShortcuts: () => void;
  /** Opens the drawer that stands in for the sidebar below the tablet breakpoint. */
  onOpenNav: () => void;
}) {
  const me = useMe();
  const theme = useTheme();
  const navigate = useNavigate();
  const crumbs = usePageMetaStore((s) => s.crumbs);
  const location = useRouterState({ select: (s) => s.location });
  const help = chapterForPath(location.pathname, location.searchStr);
  const menuRef = useRef<HTMLButtonElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const dot: Record<PresenceState['tone'], string> = {
    available: 'bg-success',
    ringing: 'bg-flare',
    on_call: 'bg-warning',
    offline: 'bg-[var(--text-faint)]',
  };

  return (
    <header className="flex h-13 shrink-0 items-center gap-3 border-b border-border bg-raised px-4 py-2.5">
      <IconButton
        icon={Menu}
        label="Open navigation"
        variant="ghost"
        size={32}
        className="md:hidden"
        onClick={onOpenNav}
      />

      <nav
        aria-label="Breadcrumb"
        className="hidden min-w-0 items-center gap-1.5 text-base md:flex"
      >
        {crumbs.map((c, i) => (
          <span key={`${c.label}-${String(i)}`} className="flex min-w-0 items-center gap-1.5">
            {i > 0 && <ChevronRight size={13} className="shrink-0 text-faint" aria-hidden />}
            {c.href !== undefined && i < crumbs.length - 1 ? (
              <Link
                to={c.href}
                className="truncate text-muted no-underline hover:text-text hover:no-underline"
              >
                {c.label}
              </Link>
            ) : (
              <span
                className={cn(
                  'truncate',
                  i === crumbs.length - 1 ? 'font-medium text-text' : 'text-muted',
                )}
              >
                {c.label}
              </span>
            )}
          </span>
        ))}
      </nav>

      <button
        type="button"
        onClick={onOpenSearch}
        className="ml-auto flex h-8 w-full max-w-[420px] items-center gap-2 rounded-sm border border-strong bg-bg px-2.5 text-base text-muted hover:border-[var(--text-faint)] md:ml-4"
      >
        <Search size={14} className="shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-left">
          Search contacts, companies, deals, leads, numbers…
        </span>
        <span className="hidden shrink-0 items-center gap-1 sm:flex">
          <Kbd>Ctrl</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <Tooltip
          content={`${presence.label}${me.extension !== null ? ` · extension ${me.extension}` : ' · no extension'}`}
        >
          <span className="hidden h-6 items-center gap-1.5 rounded-full border border-border px-2 text-sm lg:inline-flex">
            <i
              className={cn('h-[7px] w-[7px] shrink-0 rounded-full', dot[presence.tone])}
              aria-hidden
            />
            {presence.label}
            {me.extension !== null && <span className="mono text-muted">{me.extension}</span>}
          </span>
        </Tooltip>

        <Tooltip content="Help for this screen (G then L)">
          <Link
            to="/help"
            search={
              {
                chapter: help.chapter,
                ...(help.section !== undefined ? { section: help.section } : {}),
              } as never
            }
            aria-label="Help for this screen"
            className="flex h-8 w-8 items-center justify-center rounded-sm text-muted no-underline hover:bg-hover hover:text-text hover:no-underline"
          >
            <CircleHelp size={16} aria-hidden />
          </Link>
        </Tooltip>

        <NotificationBell />

        <IconButton
          icon={(theme.resolved === 'dark' ? Sun : Moon) as LucideIcon}
          label={
            theme.resolved === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'
          }
          variant="ghost"
          size={32}
          onClick={theme.toggle}
        />

        <button
          ref={menuRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="Account menu"
          onClick={() => {
            setMenuOpen((o) => !o);
          }}
          className="rounded-full"
        >
          <Avatar name={me.name} seed={me.id} src={me.avatarUrl} size={32} />
        </button>
        <DropdownMenu
          open={menuOpen}
          onOpenChange={setMenuOpen}
          anchor={menuRef}
          ariaLabel="Account"
          items={[
            {
              id: 'profile',
              label: 'Profile and security',
              icon: User,
              onSelect: () => {
                void navigate({ to: '/profile' });
              },
            },
            {
              id: 'prefs',
              label: 'Notification preferences',
              icon: Settings,
              onSelect: () => {
                void navigate({ to: '/profile', search: { tab: 'notifications' } as never });
              },
            },
            {
              id: 'shortcuts',
              label: 'Keyboard shortcuts',
              icon: Keyboard,
              shortcut: '?',
              onSelect: onOpenShortcuts,
            },
            'separator',
            {
              id: 'signout',
              label: 'Sign out',
              icon: LogOut,
              danger: true,
              onSelect: () => {
                void authClient.signOut().finally(() => {
                  window.location.assign('/sign-in');
                });
              },
            },
          ]}
        />
      </div>
    </header>
  );
}

/** Page-level header used inside screens: title, description and the action row. */
export function PageHeader({
  title,
  description,
  actions,
  tabs,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  tabs?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl">{title}</h1>
          {description !== undefined && <p className="mt-1 text-base text-muted">{description}</p>}
        </div>
        {actions !== undefined && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
      {tabs}
    </div>
  );
}

export { Button };
