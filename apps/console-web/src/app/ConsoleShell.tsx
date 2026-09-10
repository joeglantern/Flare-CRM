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
  KeyRound,
  LayoutGrid,
  LogOut,
  Moon,
  ScrollText,
  Settings,
  Sun,
  Users,
} from 'lucide-react';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { Badge, cn, IconButton, ToastHost, Tooltip } from '@crm/ui';
import { signOut } from '@/lib/auth';
import { connectSocket, disconnectSocket, useSocketStatus } from '@/lib/socket';
import { useTheme } from '@/lib/theme';
import type { Me } from '@/lib/types';

const NAV = [
  { to: '/', label: 'Fleet', icon: LayoutGrid, exact: true },
  { to: '/plans', label: 'Plans', icon: Building2, exact: false },
  { to: '/owners', label: 'Owners', icon: Users, exact: false },
  { to: '/audit', label: 'Audit', icon: ScrollText, exact: false },
  { to: '/settings', label: 'Settings', icon: Settings, exact: false },
] as const;

export function ConsoleShell({ me, children }: { me: Me; children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const connected = useSocketStatus((s) => s.connected);
  const theme = useTheme((s) => s.resolved);
  const toggleTheme = useTheme((s) => s.toggle);

  useEffect(() => {
    connectSocket();
    return () => {
      disconnectSocket();
    };
  }, []);

  return (
    <div className="grid min-h-dvh grid-cols-1 bg-bg text-text md:grid-cols-[200px_minmax(0,1fr)]">
      <nav
        aria-label="Console"
        className="flex flex-col gap-1 border-b border-border bg-surface p-3 md:border-r md:border-b-0"
      >
        <div className="mb-3 flex items-center justify-between gap-2 px-1">
          <span className="flex items-center gap-2 text-md font-semibold tracking-tight">
            <KeyRound size={15} className="text-flare" aria-hidden />
            Flare Console
          </span>
        </div>

        {NAV.map((item) => {
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
            <span className="min-w-0 truncate text-sm text-muted" title={me.email}>
              {me.name}
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
