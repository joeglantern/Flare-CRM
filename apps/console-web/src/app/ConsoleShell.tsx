/**
 * The frame around every signed-in screen: navigation on the left, the screen on the right, and
 * one live socket for the whole app.
 *
 * The socket belongs here rather than to the fleet screen, because an announcement acknowledgement
 * can land while the owner is looking at a customer, and the fleet row should already be right when
 * they go back to it.
 */
import {
  Building2,
  Gauge,
  KeyRound,
  Layers,
  LogOut,
  Moon,
  ScrollText,
  Server,
  Settings,
  Sun,
  Users,
} from 'lucide-react';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { CONSOLE_ROLE_COPY, consoleRoleOf } from '@crm/shared';
import { Badge, cn, FlareMark, IconButton, ToastHost, Tooltip } from '@crm/ui';
import { signOut } from '@/lib/auth';
import { usePermissions } from '@/lib/permissions';
import { connectSocket, disconnectSocket, useSocketStatus } from '@/lib/socket';
import { useTheme } from '@/lib/theme';
import type { Me } from '@/lib/types';

/**
 * Each entry names the permission that makes it worth showing. A support account has no business
 * on the plans screen, and a link that always answers "not allowed" teaches somebody that the
 * console is broken rather than that their account is narrow.
 */
const NAV = [
  { to: '/', label: 'Overview', icon: Gauge, exact: true, permission: 'analytics:read' },
  {
    to: '/customers',
    label: 'Customers',
    icon: Building2,
    exact: false,
    permission: 'customer:read',
  },
  { to: '/stacks', label: 'Stacks', icon: Server, exact: false, permission: 'stack:read' },
  { to: '/plans', label: 'Plans', icon: Layers, exact: false, permission: 'plan:write' },
  { to: '/owners', label: 'Owners', icon: Users, exact: false, permission: 'owner:manage' },
  { to: '/audit', label: 'Audit', icon: ScrollText, exact: false, permission: 'audit:read' },
  { to: '/settings', label: 'Settings', icon: Settings, exact: false, permission: 'settings:read' },
] as const;

export function ConsoleShell({ me, children }: { me: Me; children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const connected = useSocketStatus((s) => s.connected);
  const theme = useTheme((s) => s.resolved);
  const toggleTheme = useTheme((s) => s.toggle);
  const { can } = usePermissions();
  const nav = NAV.filter((item) => can(item.permission));
  const role = consoleRoleOf(me.role);

  useEffect(() => {
    connectSocket();
    return () => {
      disconnectSocket();
    };
  }, []);

  return (
    <div className="grid min-h-dvh grid-cols-1 bg-bg text-text md:grid-cols-[200px_minmax(0,1fr)]">
      {/* Sticky rather than part of the scrolling page: reading down a long customer list should
          never scroll the navigation off the screen. The nav's own overflow is a fallback for a
          short window, not the normal case. */}
      <nav
        aria-label="Console"
        className="flex flex-col gap-1 border-b border-border bg-surface p-3 md:sticky md:top-0 md:h-dvh md:overflow-y-auto md:border-r md:border-b-0"
      >
        <div className="mb-3 flex items-center justify-between gap-2 px-1">
          <span className="flex items-center gap-2 text-md font-semibold tracking-tight">
            {/* The mark says which product this is; the key says which half of it. Badged rather
                than set side by side, because two icons in a row read as two separate things. */}
            <span className="relative inline-flex shrink-0">
              <FlareMark size={18} title="Flare" />
              <KeyRound
                size={11}
                strokeWidth={2.5}
                aria-hidden
                className="absolute -right-1 -bottom-1 rounded-full bg-surface p-px text-muted"
              />
            </span>
            Flare Console
          </span>
        </div>

        {nav.map((item) => {
          const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                'flex items-center gap-2 rounded-sm px-2 py-1.5 text-base no-underline hover:bg-hover hover:no-underline',
                active ? 'bg-hover font-medium text-text' : 'text-muted',
              )}
            >
              <item.icon size={15} aria-hidden />
              {item.label}
            </Link>
          );
        })}

        <div className="mt-auto flex flex-col gap-2 pt-4">
          <Tooltip
            content={
              connected
                ? 'Live: stacks reporting in reach this window'
                : 'Not connected to the console socket'
            }
          >
            <span className="px-1">
              <Badge tone={connected ? 'success' : 'neutral'} dot>
                {connected ? 'Live' : 'Offline'}
              </Badge>
            </span>
          </Tooltip>

          <div className="flex items-center justify-between gap-1 border-t border-border px-1 pt-2">
            <span className="flex min-w-0 flex-col" title={me.email}>
              <span className="truncate text-sm text-muted">{me.name}</span>
              {/* Which half of the console this account is, so a narrower screen is never a puzzle. */}
              <span className="truncate text-xs text-faint">{CONSOLE_ROLE_COPY[role].label}</span>
            </span>
            <span className="flex shrink-0 items-center">
              <IconButton
                icon={theme === 'dark' ? Sun : Moon}
                label={theme === 'dark' ? 'Light theme' : 'Dark theme'}
                variant="ghost"
                size={26}
                onClick={toggleTheme}
              />
              <IconButton
                icon={LogOut}
                label="Sign out"
                variant="ghost"
                size={26}
                onClick={() => {
                  void signOut().then(() => {
                    queryClient.clear();
                    disconnectSocket();
                    return navigate({ to: '/sign-in' });
                  });
                }}
              />
            </span>
          </div>
        </div>
      </nav>

      <main className="min-w-0 p-5">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">{children}</div>
      </main>

      <ToastHost />
    </div>
  );
}
