/**
 * AppShell (Component Inventory · App shell): sidebar, top bar, banners, call strip, toasts and
 * the routed outlet. Mounted once above the router so the call popup and notifications survive
 * navigation (docs/17 §2).
 */
import { Outlet, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ToastHost } from '@/components/ui/toast';
import { useConversations } from '@/features/inbox/api';
import { useLeads } from '@/features/leads/api';
import { useTasks } from '@/features/tasks/api';
import { useCalls } from '@/features/calls/api';
import { CallPopupHost } from '@/features/telephony/CallPopup';
import { useCtiStatus } from '@/features/telephony/api';
import { activeCall, useCallStore } from '@/features/telephony/call-store';
import { DialerProvider } from '@/features/telephony/dialer';
import { useChannels } from '@/features/inbox/api';
import { usePermissions } from '@/providers/permissions';
import { GOTO_SEQUENCES, isTypingTarget } from './shortcuts';
import { Banners } from './Banners';
import { CommandPalette } from './CommandPalette';
import { MobileNav } from './MobileNav';
import { Sidebar } from './Sidebar';
import { SessionExpiredDialog } from './SessionExpiredDialog';
import { ShortcutsSheet } from './ShortcutsSheet';
import { TopBar, type PresenceState } from './TopBar';

const COLLAPSE_KEY = 'flare.sidebar.collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

export function AppShell({ children }: { children?: ReactNode }) {
  const perms = usePermissions();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const goPrefix = useRef<number>(0);

  const cards = useCallStore((s) => s.cards);
  const live = activeCall(cards);
  const ringing = cards.some((c) => c.status === 'ringing');

  const cti = useCtiStatus(perms.has('pbx:view_status'));
  const channels = useChannels(perms.has('chat:read'));

  // Sidebar counts. Each is the same query the screen behind it uses, so nothing is fetched twice.
  const leads = useLeads({ status: 'new', pageSize: 1 }, perms.has('lead:read'));
  const tasks = useTasks(
    { mine: 'true', status: 'open', overdue: 'true', pageSize: 1 },
    perms.has('task:read'),
  );
  const missed = useCalls({ status: 'missed', mine: 'true', pageSize: 1 }, perms.has('call:read'));
  const inbox = useConversations({ mine: 'true', status: 'open' }, perms.has('chat:read'));

  const toggleSidebar = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        /* private mode */
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = isTypingTarget(e.target);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleSidebar();
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '/') {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (e.key === '?') {
        e.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      // "g" then a letter jumps to a section
      if (e.key.toLowerCase() === 'g') {
        goPrefix.current = Date.now();
        return;
      }
      if (Date.now() - goPrefix.current < 1200) {
        const target = GOTO_SEQUENCES.find((s) => s.key === e.key.toLowerCase());
        goPrefix.current = 0;
        if (target && (target.permission === undefined || perms.has(target.permission))) {
          e.preventDefault();
          void navigate({ to: target.to });
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [navigate, perms, toggleSidebar]);

  const presence: PresenceState = ringing
    ? { tone: 'ringing', label: 'Ringing' }
    : live !== undefined
      ? { tone: 'on_call', label: 'On a call' }
      : cti.data?.enabled === true && !cti.data.connected
        ? { tone: 'offline', label: 'PBX offline' }
        : { tone: 'available', label: 'Available' };

  const activeChannel = (channels.data ?? []).find((c) => c.isActive);

  return (
    <DialerProvider>
      <div className="flex h-dvh min-h-0 w-full overflow-hidden bg-bg">
        <div className="hidden md:flex">
          <Sidebar
            collapsed={collapsed}
            onToggle={toggleSidebar}
            counts={{
              leads: leads.data?.page.total,
              tasks: tasks.data?.page.total,
              calls: missed.data?.page.total,
              inbox: inbox.data?.pages[0]?.data.filter((c) => c.unreadCount > 0).length,
            }}
            pbx={{ enabled: cti.data?.enabled ?? false, connected: cti.data?.connected ?? false }}
            channel={{
              enabled: activeChannel !== undefined,
              connected: activeChannel !== undefined,
            }}
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar
            presence={presence}
            onOpenSearch={() => {
              setPaletteOpen(true);
            }}
            onOpenShortcuts={() => {
              setShortcutsOpen(true);
            }}
            onOpenNav={() => {
              setNavOpen(true);
            }}
          />
          <Banners
            pbx={{
              enabled: cti.data?.enabled ?? false,
              connected: cti.data?.connected ?? true,
              since: cti.data?.since ?? null,
            }}
            channel={{
              enabled: activeChannel !== undefined,
              connected: activeChannel !== undefined,
            }}
          />
          <main className="min-h-0 flex-1 overflow-y-auto">{children ?? <Outlet />}</main>
        </div>
      </div>

      <MobileNav
        open={navOpen}
        onOpenChange={setNavOpen}
        counts={{
          leads: leads.data?.page.total,
          tasks: tasks.data?.page.total,
          calls: missed.data?.page.total,
          inbox: inbox.data?.pages[0]?.data.filter((c) => c.unreadCount > 0).length,
        }}
        pbx={{ enabled: cti.data?.enabled ?? false, connected: cti.data?.connected ?? false }}
        channel={{
          enabled: activeChannel !== undefined,
          connected: activeChannel !== undefined,
        }}
      />
      <CallPopupHost />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <ShortcutsSheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <SessionExpiredDialog />
      <ToastHost />
    </DialerProvider>
  );
}
