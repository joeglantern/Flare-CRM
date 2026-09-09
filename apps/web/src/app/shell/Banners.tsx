/**
 * The shell banner stack (Component Inventory · Banner): offline, PBX down, WhatsApp down and
 * maintenance announcements. Each names the socket event that drives it.
 */
import type { ServerToClientEvents } from '@crm/shared';
import { CalendarClock, Info, MessageCircle, Unplug, WifiOff } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Banner } from '@/components/ui/Banner';
import { formatTime } from '@/lib/format';
import { useSocketEvent } from '@/lib/socket/client';
import { usePlanState } from '@/providers/entitlements';
import { useSettings } from '@/providers/settings';
import { useSocketState } from '@/providers/socket';

export interface ChannelHealth {
  enabled: boolean;
  connected: boolean;
}

export function Banners({
  pbx,
  channel,
  onReconnectPbx,
}: {
  pbx: { enabled: boolean; connected: boolean; since: string | null };
  channel: ChannelHealth;
  onReconnectPbx?: () => void;
}) {
  const { online } = useSocketState();
  const settings = useSettings();
  const plan = usePlanState();
  const [announce, setAnnounce] = useState<{
    level: 'info' | 'warning' | 'error';
    message: string;
  } | null>(null);

  useSocketEvent(
    'system:announce',
    useCallback<ServerToClientEvents['system:announce']>((p) => {
      setAnnounce({ level: p.level, message: p.message });
    }, []),
  );

  return (
    <>
      {!online && (
        <Banner tone="warning" icon={WifiOff}>
          You are offline. Changes will not be saved until the connection returns.
        </Banner>
      )}
      {plan.expired && (
        <Banner tone="danger" icon={CalendarClock} meta="plan">
          Your plan ended, so the CRM is read only. Everything is still here and nothing has been
          deleted. Contact {plan.ownerContact.name} at{' '}
          <a href={`mailto:${plan.ownerContact.email}`}>{plan.ownerContact.email}</a> to renew.
        </Banner>
      )}
      {plan.expiringSoon && (
        <Banner tone="warning" icon={CalendarClock} meta="plan">
          Your plan ends in {plan.expiresInDays} {plan.expiresInDays === 1 ? 'day' : 'days'}. After
          that the CRM becomes read only until it is renewed.
        </Banner>
      )}
      {pbx.enabled && !pbx.connected && (
        <Banner
          tone="danger"
          icon={Unplug}
          meta="pbx:status"
          {...(onReconnectPbx !== undefined
            ? { action: { label: 'Reconnect', onClick: onReconnectPbx } }
            : {})}
        >
          PBX disconnected
          {pbx.since !== null && ` since ${formatTime(pbx.since, settings.timezone)}`}.
          Click-to-dial and call popups are paused.
        </Banner>
      )}
      {channel.enabled && !channel.connected && (
        <Banner tone="danger" icon={MessageCircle} meta="channel">
          WhatsApp channel unavailable. Inbound messages will arrive when it reconnects; sending is
          disabled.
        </Banner>
      )}
      {announce !== null && (
        <Banner
          tone={
            announce.level === 'error'
              ? 'danger'
              : announce.level === 'warning'
                ? 'warning'
                : 'flare'
          }
          icon={Info}
          meta="system:announce"
          action={{
            label: 'Dismiss',
            onClick: () => {
              setAnnounce(null);
            },
          }}
        >
          {announce.message}
        </Banner>
      )}
    </>
  );
}
