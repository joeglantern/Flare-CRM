/**
 * IncomingCallPopup and CallStrip (Component Inventory · Telephony) — the whole popup:
 * ringing, dialing, in-call, answered elsewhere and ended, with the caller context and actions.
 *
 * Rules from the App Shell design and Flows · Incoming call:
 *  - rendered within 300 ms of call:ringing on any route (the payload carries the context, so
 *    there is no second request before it can appear)
 *  - aria-live assertive while ringing, focus-trapped only in that state
 *  - Enter answers and Esc declines while ringing
 *  - buttons the PBX cannot do are hidden, not disabled (capabilities)
 *  - the timer runs from the server's answeredAt so every tab agrees
 *  - the recording consent text from Settings is in front of the agent
 */
import type { ServerToClientEvents } from '@crm/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  Ban,
  CircleDot,
  History,
  Mic,
  MicOff,
  Minimize2,
  Pause,
  Phone,
  PhoneForwarded,
  PhoneIncoming,
  PhoneOff,
  PhoneOutgoing,
  Play,
  ShieldAlert,
  UserPlus,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Kbd } from '@/components/ui/Kbd';
import { Tooltip } from '@/components/ui/Tooltip';
import { toast } from '@/components/ui/toast';
import { DateTime } from '@/components/data/formatters';
import { errorMessage } from '@/lib/api/errors';
import { formatDuration, formatPhone } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import { useSocketEvent } from '@/lib/socket/client';
import { usePermissions } from '@/providers/permissions';
import { useSettings } from '@/providers/settings';
import { cn } from '@/lib/utils';
import { useCallControl, useCapabilities } from './api';
import { activeCall, talkSeconds, useCallStore, type CallCard } from './call-store';
import { DispositionForm } from './DispositionForm';
import { TransferPicker } from './TransferPicker';

/** Ticks once a second while a call is up; the value itself comes from server timestamps. */
/** The wall clock, re-read once a second while a call is live, so timers stay honest. */
const useTick = (active: boolean): number => useNow(active, 1000);

export function CallPopupHost() {
  const cards = useCallStore((s) => s.cards);
  const lastCancelled = useCallStore((s) => s.lastCancelled);
  const clearCancelled = useCallStore((s) => s.clearCancelled);
  const [minimised, setMinimised] = useState<string[]>([]);
  const navigate = useNavigate();

  // A cancelled call leaves a short toast rather than a card (Flows · branches).
  useEffect(() => {
    if (lastCancelled === null) return;
    const reason =
      lastCancelled.reason === 'answered_elsewhere'
        ? 'Answered by a colleague'
        : lastCancelled.reason === 'timeout'
          ? 'Nobody answered'
          : 'Caller hung up';
    toast({
      tone: lastCancelled.reason === 'timeout' ? 'warning' : 'neutral',
      title: reason,
      description: lastCancelled.callerDisplay ?? undefined,
      key: `call-${lastCancelled.pbxCallId}`,
    });
    clearCancelled();
  }, [lastCancelled, clearCancelled]);

  // Missed calls arrive as call:logged with status missed: toast with a Call back action.
  useSocketEvent(
    'call:logged',
    useCallback<ServerToClientEvents['call:logged']>(
      (p) => {
        if (p.status !== 'missed') return;
        toast({
          tone: 'warning',
          title: 'Missed call',
          description: 'It is waiting in Missed calls.',
          action: {
            label: 'Open',
            onClick: () => {
              void navigate({ to: '/calls/missed' });
            },
          },
          key: `missed-${p.callId}`,
        });
      },
      [navigate],
    ),
  );

  const visible = cards.filter((c) => !minimised.includes(c.pbxCallId));
  const hidden = cards.filter((c) => minimised.includes(c.pbxCallId));

  return (
    <>
      {hidden.length > 0 && (
        <CallStrip
          cards={hidden}
          onExpand={(id) => {
            setMinimised((m) => m.filter((x) => x !== id));
          }}
        />
      )}
      <div className="pointer-events-none fixed right-4 bottom-4 z-[75] flex w-[380px] max-w-[calc(100vw-2rem)] flex-col gap-2 max-sm:right-0 max-sm:bottom-0 max-sm:w-full max-sm:max-w-none">
        {visible.map((card, i) => (
          <div key={card.pbxCallId} className="pointer-events-auto">
            <CallCardView
              card={card}
              stacked={i > 0}
              onMinimise={() => {
                setMinimised((m) => [...m, card.pbxCallId]);
              }}
            />
          </div>
        ))}
      </div>
    </>
  );
}

/** Persistent strip while a call is active but the popup is minimised. */
export function CallStrip({
  cards,
  onExpand,
}: {
  cards: CallCard[];
  onExpand: (pbxCallId: string) => void;
}) {
  const now = useTick(true);
  const card = activeCall(cards) ?? cards[0];
  if (!card) return null;
  const inCall = card.status === 'answered';
  return (
    <div
      className={cn(
        'fixed right-4 bottom-4 z-[74] flex items-center gap-2.5 rounded-md border px-3 py-2 text-base shadow-float max-sm:right-2 max-sm:left-2',
        inCall
          ? 'border-success bg-[var(--success-subtle)]'
          : 'border-flare bg-[var(--flare-subtle)]',
      )}
    >
      <i
        className={cn(
          'h-2 w-2 shrink-0 rounded-full',
          inCall ? 'bg-success live-pulse' : 'bg-flare ring-pulse',
        )}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate">
        {inCall
          ? card.hold
            ? 'On hold'
            : 'On a call'
          : card.status === 'dialing'
            ? 'Dialing'
            : 'Ringing'}
        {cards.length > 1 && <span className="ml-1.5 text-muted">+{cards.length - 1}</span>}
      </span>
      <span className="mono tnum shrink-0">
        {formatDuration(
          card.answeredAt !== null
            ? talkSeconds(card, now)
            : Math.floor((now - card.receivedAt) / 1000),
        )}
      </span>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          onExpand(card.pbxCallId);
        }}
      >
        Show call
      </Button>
    </div>
  );
}

function CallCardView({
  card,
  stacked,
  onMinimise,
}: {
  card: CallCard;
  stacked: boolean;
  onMinimise: () => void;
}) {
  const caps = useCapabilities();
  const settings = useSettings();
  const perms = usePermissions();
  const navigate = useNavigate();
  const close = useCallStore((s) => s.close);
  const control = useCallControl(card.callId ?? '');
  const panel = useRef<HTMLDivElement | null>(null);
  const now = useTick(
    card.status === 'answered' || card.status === 'ringing' || card.status === 'dialing',
  );
  const [transferOpen, setTransferOpen] = useState(false);

  const ringing = card.status === 'ringing';
  const inCall = card.status === 'answered';
  const ended = card.status === 'ended' || card.status === 'logged';
  const payload = card.ringing;
  const contact = payload?.contact ?? null;
  const unknown = payload !== null && contact === null;
  const restricted = payload?.restricted === true;

  const number = payload?.callerNumber ?? card.callee ?? null;
  const display =
    payload?.callerDisplay ?? (number !== null ? formatPhone(number) : 'Unknown number');

  const act = useCallback(
    (action: 'answer' | 'decline' | 'hangup' | 'hold' | 'unhold' | 'mute' | 'unmute') => {
      if (card.callId === null) return;
      control.mutate(
        { action, transferType: 'blind' },
        {
          onError: (e) => {
            toast({ tone: 'danger', title: 'The PBX rejected that', description: errorMessage(e) });
          },
        },
      );
    },
    [card.callId, control],
  );

  // Focus trap and Enter/Esc only while ringing, so the popup never steals typing later.
  useEffect(() => {
    if (!ringing) return;
    const el = panel.current;
    const previous = document.activeElement as HTMLElement | null;
    el?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && caps.answer !== 'none') {
        e.preventDefault();
        act('answer');
      } else if (e.key === 'Escape' && caps.decline) {
        e.preventDefault();
        act('decline');
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [ringing, caps.answer, caps.decline, act]);

  const header = ringing
    ? 'Incoming call'
    : card.status === 'dialing'
      ? 'Dialing'
      : inCall
        ? card.hold
          ? 'On hold'
          : 'On a call'
        : 'Call ended';

  const timer =
    card.answeredAt !== null
      ? formatDuration(talkSeconds(card, now))
      : formatDuration(Math.max(0, Math.floor((now - card.receivedAt) / 1000)));

  const contextRows = useMemo(() => payload?.recentActivity.slice(0, 3) ?? [], [payload]);

  return (
    <div
      ref={panel}
      tabIndex={-1}
      role={ringing ? 'alertdialog' : 'dialog'}
      aria-live={ringing ? 'assertive' : 'polite'}
      aria-label={`${header} ${display}`}
      className={cn(
        'slide-up flex flex-col overflow-hidden rounded-lg border bg-raised shadow-float outline-none max-sm:rounded-b-none',
        ringing ? 'border-flare' : inCall ? 'border-success' : 'border-border',
        stacked && 'opacity-95',
      )}
    >
      <div
        className={cn(
          'flex items-center gap-2 px-3.5 py-2.5 text-base',
          ringing
            ? 'bg-[var(--flare-subtle)]'
            : inCall
              ? 'bg-[var(--success-subtle)]'
              : 'bg-surface',
        )}
      >
        <i
          className={cn(
            'h-2 w-2 shrink-0 rounded-full',
            ringing
              ? 'bg-flare ring-pulse'
              : inCall
                ? 'bg-success live-pulse'
                : 'bg-[var(--text-faint)]',
          )}
          aria-hidden
        />
        <span
          className={cn(
            'font-medium',
            ringing ? 'text-flare-on' : inCall ? 'text-success' : 'text-text',
          )}
        >
          {header}
        </span>
        {payload?.direction === 'outbound' || card.direction === 'outbound' ? (
          <PhoneOutgoing size={13} className="text-muted" aria-hidden />
        ) : (
          <PhoneIncoming size={13} className="text-muted" aria-hidden />
        )}
        <span className="mono tnum ml-auto text-sm text-muted">{timer}</span>
        {(inCall || card.status === 'dialing') && (
          <IconButton
            icon={Minimize2}
            label="Minimise"
            variant="ghost"
            size={26}
            onClick={onMinimise}
          />
        )}
      </div>

      <div className="flex flex-col gap-3 px-3.5 py-3">
        <div className="flex items-start gap-3">
          {contact !== null ? (
            <Avatar
              name={contact.displayName}
              seed={contact.id}
              src={contact.avatarUrl}
              size={40}
            />
          ) : (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-hover text-muted">
              <Phone size={18} aria-hidden />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="truncate text-lg font-semibold">
                {contact?.displayName ?? display}
              </span>
              {contact?.doNotCall === true && (
                <Badge tone="danger" icon={Ban}>
                  Do not call
                </Badge>
              )}
              {restricted && (
                <Badge tone="warning" icon={ShieldAlert}>
                  Restricted
                </Badge>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted">
              {contact?.company != null && <span className="truncate">{contact.company.name}</span>}
              {number !== null && <span className="mono">{display}</span>}
              {payload?.didNumber != null && <span>via {payload.didNumber}</span>}
            </div>
          </div>
        </div>

        {contact !== null && !restricted && contextRows.length > 0 && (
          <ul className="flex flex-col gap-1 rounded-md border border-border bg-surface px-2.5 py-2 text-sm">
            {contextRows.map((a) => (
              <li key={a.id} className="flex items-center gap-2">
                <History size={12} className="shrink-0 text-muted" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{a.summary}</span>
                <DateTime value={a.occurredAt} bare className="shrink-0 text-muted" />
              </li>
            ))}
          </ul>
        )}

        {unknown && payload.matchCandidates.length > 0 && (
          <div className="rounded-md border border-border bg-surface px-2.5 py-2 text-sm">
            <div className="mb-1 flex items-center gap-1.5 text-muted">
              <Users size={12} aria-hidden />
              Possible matches
            </div>
            {payload.matchCandidates.slice(0, 3).map((m) => (
              <Link
                key={m.id}
                to="/contacts/$contactId"
                params={{ contactId: m.id }}
                className="block truncate py-0.5"
              >
                {m.displayName}
              </Link>
            ))}
          </div>
        )}

        {ended && card.callId !== null ? (
          <DispositionForm
            callId={card.callId}
            contactId={payload?.contact?.id ?? null}
            suggestFollowUp={
              card.logged?.suggestFollowUp ?? settings.popup.suggestFollowUpAfterCall
            }
            summary={
              card.logged !== null
                ? `talk ${formatDuration(card.logged.talkDurationSec ?? 0)} · total ${formatDuration(
                    card.logged.totalDurationSec ?? 0,
                  )}`
                : undefined
            }
            onDone={() => {
              close(card.pbxCallId);
            }}
          />
        ) : (
          <>
            {ringing && (
              <div className="flex flex-wrap gap-2">
                {caps.decline && (
                  <Button
                    variant="secondary"
                    icon={PhoneOff}
                    onClick={() => {
                      act('decline');
                    }}
                    kbd="Esc"
                  >
                    Decline
                  </Button>
                )}
                {caps.answer !== 'none' && (
                  <Button
                    variant="primary"
                    icon={Phone}
                    className="flex-1"
                    onClick={() => {
                      act('answer');
                    }}
                    kbd="↵"
                  >
                    Answer
                  </Button>
                )}
                {caps.answer === 'none' && (
                  <p className="text-sm text-muted">
                    Pick up your desk phone to answer. This PBX does not allow answering over the
                    API.
                  </p>
                )}
              </div>
            )}

            {(inCall || card.status === 'dialing') && (
              <div className="flex flex-wrap gap-2">
                {caps.hold && inCall && (
                  <Button
                    variant="secondary"
                    icon={card.hold ? Play : Pause}
                    onClick={() => {
                      act(card.hold ? 'unhold' : 'hold');
                    }}
                    className={card.hold ? 'border-warning bg-[var(--warning-subtle)]' : ''}
                  >
                    {card.hold ? 'Resume' : 'Hold'}
                  </Button>
                )}
                {caps.mute && inCall && (
                  <Button
                    variant="secondary"
                    icon={card.muted ? Mic : MicOff}
                    onClick={() => {
                      act(card.muted ? 'unmute' : 'mute');
                    }}
                    className={card.muted ? 'border-warning bg-[var(--warning-subtle)]' : ''}
                  >
                    {card.muted ? 'Unmute' : 'Mute'}
                  </Button>
                )}
                {caps.transfer && inCall && (
                  <Button
                    variant="secondary"
                    icon={PhoneForwarded}
                    onClick={() => {
                      setTransferOpen(true);
                    }}
                  >
                    Transfer
                  </Button>
                )}
                {caps.hangup && (
                  <Button
                    variant="danger"
                    icon={PhoneOff}
                    className="ml-auto"
                    onClick={() => {
                      act('hangup');
                    }}
                  >
                    Hang up
                  </Button>
                )}
              </div>
            )}

            {card.status === 'ended' && card.callId === null && (
              <Button
                variant="secondary"
                onClick={() => {
                  close(card.pbxCallId);
                }}
              >
                Close
              </Button>
            )}

            <div className="flex flex-wrap items-center gap-2 text-sm">
              {contact !== null && !restricted && (
                <Link
                  to="/contacts/$contactId"
                  params={{ contactId: contact.id }}
                  className="no-underline hover:no-underline"
                >
                  <Button size="sm" variant="ghost">
                    Open contact
                  </Button>
                </Link>
              )}
              {unknown && perms.has('contact:create') && number !== null && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={UserPlus}
                  onClick={() => {
                    void navigate({ to: '/contacts', search: { create: number } as never });
                  }}
                >
                  Create contact
                </Button>
              )}
              {card.callId !== null && (
                <Link
                  to="/calls/$callId"
                  params={{ callId: card.callId }}
                  className="ml-auto no-underline hover:no-underline"
                >
                  <Button size="sm" variant="ghost" icon={CircleDot}>
                    Call detail
                  </Button>
                </Link>
              )}
            </div>

            {settings.recording.consentText !== '' && (inCall || ringing) && (
              <p className="border-t border-border pt-2 text-xs text-faint">
                {settings.recording.consentText}
              </p>
            )}
          </>
        )}
      </div>

      {ringing && (
        <div className="border-t border-border bg-surface px-3.5 py-2 text-xs text-faint">
          {unknown ? (
            'Answering will log the call to this number. Create the contact to link it.'
          ) : restricted ? (
            <>
              Answer is available; opening the contact requires{' '}
              <span className="mono">contact:read</span> in this scope.
            </>
          ) : (
            <>
              <Kbd>↵</Kbd> answers · <Kbd>Esc</Kbd> declines
            </>
          )}
        </div>
      )}

      {transferOpen && card.callId !== null && (
        <TransferPicker callId={card.callId} open={transferOpen} onOpenChange={setTransferOpen} />
      )}
    </div>
  );
}

/** Tooltip re-export keeps the import list in screens short. */
export { Tooltip };
