/**
 * Sidebar (Component Inventory · App shell): collapsible nav filtered by role, with the PBX and
 * WhatsApp status dots and the user block. Collapsed state persists per user; Ctrl+B toggles it.
 */
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { Link, useRouterState } from '@tanstack/react-router';
import { Avatar } from '@/components/ui/Avatar';
import { IconButton } from '@/components/ui/Button';
import { Tooltip } from '@/components/ui/Tooltip';
import { useMe } from '@/lib/auth/me';
import { usePermissions } from '@/providers/permissions';
import { cn } from '@/lib/utils';
import { NAV_ITEMS } from './nav';

export interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  counts: Partial<Record<'leads' | 'tasks' | 'calls' | 'inbox', number>>;
  pbx: { connected: boolean; enabled: boolean };
  channel: { connected: boolean; enabled: boolean };
}

export function Sidebar({ collapsed, onToggle, counts, pbx, channel }: SidebarProps) {
  const me = useMe();
  const perms = usePermissions();
  const path = useRouterState({ select: (s) => s.location.pathname });

  const items = NAV_ITEMS.filter(
    (n) => n.roles.includes(me.role) && (n.permission === undefined || perms.has(n.permission)),
  );

  return (
    <nav
      aria-label="Main"
      style={{ width: collapsed ? 56 : 232 }}
      className="flex shrink-0 flex-col border-r border-border bg-raised transition-[width] duration-[var(--dur-panel)] ease-[var(--ease-out)]"
    >
      <div
        className={cn(
          'flex h-13 shrink-0 items-center gap-2 px-3 py-3.5',
          collapsed && 'justify-center px-0',
        )}
      >
        <Link
          to="/home"
          className="flex min-w-0 items-center gap-2 no-underline hover:no-underline"
        >
          <img src="/brand/mark.svg" alt="" width={20} height={20} className="shrink-0" />
          {!collapsed && (
            <span className="flex items-baseline gap-1.5 leading-none">
              <span className="text-lg font-extrabold tracking-[-0.03em] text-text">Flare</span>
              <span className="text-2xs font-medium tracking-[0.22em] text-muted">CRM</span>
            </span>
          )}
        </Link>
      </div>

      <div className="scrollbar-none flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
        {items.map((item) => {
          const active = path === item.href || path.startsWith(`${item.href}/`);
          const count = item.count !== undefined ? counts[item.count] : undefined;
          const link = (
            <Link
              key={item.id}
              to={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex h-8 items-center gap-2.5 rounded-sm px-2 text-base no-underline hover:no-underline',
                collapsed && 'justify-center px-0',
                active
                  ? 'bg-[var(--flare-subtle)] font-medium text-flare-on'
                  : 'text-muted hover:bg-hover hover:text-text',
              )}
            >
              <item.icon size={16} className="shrink-0" aria-hidden />
              {!collapsed && (
                <>
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {count !== undefined && count > 0 && (
                    <span className="tnum shrink-0 text-xs text-faint">
                      {count > 99 ? '99+' : count}
                    </span>
                  )}
                </>
              )}
              {collapsed && count !== undefined && count > 0 && (
                <span
                  className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-flare"
                  aria-hidden
                />
              )}
            </Link>
          );
          return collapsed ? (
            <Tooltip key={item.id} content={item.label} side="right" delay={100}>
              <span className="relative block">{link}</span>
            </Tooltip>
          ) : (
            link
          );
        })}
      </div>

      <div className="flex flex-col gap-2 border-t border-border p-2">
        <StatusDots collapsed={collapsed} pbx={pbx} channel={channel} />
        <Link
          to="/profile"
          className={cn(
            'flex items-center gap-2 rounded-sm p-1.5 no-underline hover:bg-hover hover:no-underline',
            collapsed && 'justify-center p-1',
          )}
        >
          <Avatar name={me.name} seed={me.id} src={me.avatarUrl} size={collapsed ? 24 : 32} />
          {!collapsed && (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-base text-text">{me.name}</span>
              <span className="block truncate text-sm text-muted">
                {me.role === 'admin' ? 'Admin' : me.role === 'manager' ? 'Manager' : 'Agent'}
                {me.extension !== null && <span className="mono"> · {me.extension}</span>}
              </span>
            </span>
          )}
        </Link>
        <div className={cn('flex', collapsed ? 'justify-center' : 'justify-end')}>
          <IconButton
            icon={collapsed ? ChevronsRight : ChevronsLeft}
            label={collapsed ? 'Expand sidebar (Ctrl+B)' : 'Collapse sidebar (Ctrl+B)'}
            variant="ghost"
            size={26}
            onClick={onToggle}
          />
        </div>
      </div>
    </nav>
  );
}

export function StatusDots({
  collapsed,
  pbx,
  channel,
}: {
  collapsed: boolean;
  pbx: { connected: boolean; enabled: boolean };
  channel: { connected: boolean; enabled: boolean };
}) {
  const rows = [
    {
      id: 'pbx',
      label: 'PBX',
      enabled: pbx.enabled,
      connected: pbx.connected,
      text: !pbx.enabled ? 'not enabled' : pbx.connected ? 'connected' : 'disconnected',
    },
    {
      id: 'wa',
      label: 'WhatsApp',
      enabled: channel.enabled,
      connected: channel.connected,
      text: !channel.enabled ? 'not configured' : channel.connected ? 'connected' : 'unavailable',
    },
  ];
  return (
    <div
      className={cn(
        'flex gap-2 text-xs text-muted',
        collapsed ? 'flex-col items-center' : 'flex-col px-1.5',
      )}
    >
      {rows.map((r) => {
        const dot = (
          <i
            className={cn(
              'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
              !r.enabled ? 'bg-[var(--text-faint)]' : r.connected ? 'bg-success' : 'bg-danger',
            )}
            aria-hidden
          />
        );
        return collapsed ? (
          <Tooltip key={r.id} content={`${r.label} ${r.text}`} side="right">
            <span className="flex h-4 items-center">{dot}</span>
          </Tooltip>
        ) : (
          <span key={r.id} className="flex items-center gap-1.5">
            {dot}
            <span className="truncate">
              {r.label} {r.text}
            </span>
          </span>
        );
      })}
    </div>
  );
}
