/**
 * Navigation for narrower than the tablet breakpoint (Component Inventory · App shell). The
 * sidebar itself is `hidden md:flex` and has no mobile equivalent, so below that width there was
 * no way to reach anything but the page already open. This is the same destinations, role and
 * permission filtered exactly like the sidebar, in a drawer a hamburger button opens and any tap
 * on a destination closes.
 */
import { Link, useRouterState } from '@tanstack/react-router';
import { Avatar } from '@/components/ui/Avatar';
import { Drawer } from '@/components/ui/Overlay';
import { useMe } from '@/lib/auth/me';
import { useEntitlements } from '@/providers/entitlements';
import { usePermissions } from '@/providers/permissions';
import { cn } from '@/lib/utils';
import { NAV_ITEMS } from './nav';
import { StatusDots } from './Sidebar';

export function MobileNav({
  open,
  onOpenChange,
  counts,
  pbx,
  channel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  counts: Partial<Record<'leads' | 'tasks' | 'calls' | 'inbox', number>>;
  pbx: { connected: boolean; enabled: boolean };
  channel: { connected: boolean; enabled: boolean };
}) {
  const me = useMe();
  const perms = usePermissions();
  const path = useRouterState({ select: (s) => s.location.pathname });

  const { features } = useEntitlements();
  const items = NAV_ITEMS.filter(
    (n) =>
      n.roles.includes(me.role) &&
      (n.permission === undefined || perms.has(n.permission)) &&
      (n.feature === undefined || features[n.feature]),
  );

  return (
    <Drawer open={open} onOpenChange={onOpenChange} side="left" width={280} title="Flare CRM">
      <div className="-mt-2 flex flex-col gap-0.5">
        {items.map((item) => {
          const active = path === item.href || path.startsWith(`${item.href}/`);
          const count = item.count !== undefined ? counts[item.count] : undefined;
          return (
            <Link
              key={item.id}
              to={item.href}
              aria-current={active ? 'page' : undefined}
              onClick={() => {
                onOpenChange(false);
              }}
              className={cn(
                'flex h-10 items-center gap-3 rounded-sm px-2.5 text-base no-underline hover:no-underline',
                active
                  ? 'bg-[var(--flare-subtle)] font-medium text-flare-on'
                  : 'text-muted hover:bg-hover hover:text-text',
              )}
            >
              <item.icon size={18} className="shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {count !== undefined && count > 0 && (
                <span className="tnum shrink-0 text-sm text-faint">
                  {count > 99 ? '99+' : count}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      <div className="mt-4 flex flex-col gap-3 border-t border-border pt-3">
        <StatusDots collapsed={false} pbx={pbx} channel={channel} />
        <Link
          to="/profile"
          onClick={() => {
            onOpenChange(false);
          }}
          className="flex items-center gap-2 rounded-sm p-1.5 no-underline hover:bg-hover hover:no-underline"
        >
          <Avatar name={me.name} seed={me.id} src={me.avatarUrl} size={32} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base text-text">{me.name}</span>
            <span className="block truncate text-sm text-muted">
              {me.role === 'admin' ? 'Admin' : me.role === 'manager' ? 'Manager' : 'Agent'}
              {me.extension !== null && <span className="mono"> · {me.extension}</span>}
            </span>
          </span>
        </Link>
      </div>
    </Drawer>
  );
}
