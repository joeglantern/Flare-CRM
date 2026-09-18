/**
 * Dialpad (Calls · Dialpad). A keypad for numbers that are not yet contacts, plus a
 * recent-calls strip so redialling does not mean going back to the list.
 *
 * What it will actually dial is shown under the field before the call is placed, because a wrong
 * outbound prefix is the failure that otherwise only shows up as silence on the line.
 * Every control is disabled with the reason when the PBX is disconnected or the user has no
 * extension. The dial itself goes through the shared dialer so the confirmation is identical
 * everywhere in the app.
 *
 * The pad is its own plan feature (docs/20). A workspace without it sees the real pad behind a
 * blur with a padlock over it rather than an empty page: what is missing is worth showing, and the
 * server refuses a numbers-only dial anyway, so nothing here is load bearing.
 */
import { Delete, Lock, Phone, Plus, Unplug, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { IconButton } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Loading';
import { Avatar } from '@/components/ui/Avatar';
import { Banner } from '@/components/ui/Banner';
import { Dialog } from '@/components/ui/Overlay';
import { DateTime, Duration } from '@/components/data/formatters';
import { CallDirection, CallStatusBadge } from '@/components/data/status';
import { EmptyState, ForbiddenState } from '@/components/data/states';
import { Panel } from '@/components/entity/EntityHeader';
import { PageHeader } from '@/app/shell/TopBar';
import { usePageMeta } from '@/app/shell/page-meta';
import { useCalls } from '@/features/calls/api';
import { useContactSearch } from '@/features/contacts/api';
import { formatPhone } from '@/lib/format';
import { linkTo } from '@/lib/links';
import { useDebounced } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { Link, useNavigate } from '@tanstack/react-router';
import { usePermissions } from '@/providers/permissions';
import { useEntitlements } from '@/providers/entitlements';
import { useSettings, useFullSettings } from '@/providers/settings';
import { previewDialable, useCapabilities, useCtiStatus, type DialRules } from './api';
import { useDialer } from './dialer';

const KEYS = [
  ['1', ''],
  ['2', 'ABC'],
  ['3', 'DEF'],
  ['4', 'GHI'],
  ['5', 'JKL'],
  ['6', 'MNO'],
  ['7', 'PQRS'],
  ['8', 'TUV'],
  ['9', 'WXYZ'],
  ['*', ''],
  ['0', '+'],
  ['#', ''],
] as const;

export function DialpadScreen() {
  usePageMeta([{ label: 'Calls', href: '/calls' }, { label: 'Dialpad' }]);
  const perms = usePermissions();
  const navigate = useNavigate();
  const caps = useCapabilities();
  const status = useCtiStatus(perms.has('pbx:view_status'));
  const dialer = useDialer();
  const { features } = useEntitlements();
  const [digits, setDigits] = useState('');

  const debounced = useDebounced(digits, 300);
  const inPlan = features.dialpad;
  const matches = useContactSearch(inPlan && debounced.length >= 4 ? debounced : '');

  const recent = useCalls(
    { mine: 'true', pageSize: 8, sort: '-startedAt' },
    perms.has('call:read'),
  );

  if (!perms.has('call:dial')) {
    return (
      <ForbiddenState
        permission="call:dial"
        what="the dialpad"
        backTo={{ label: 'Calls', href: '/calls' }}
      />
    );
  }

  const blockedReason = dialer.reason;

  return (
    <div className="flex flex-col gap-4 p-6">
      <PageHeader title="Dialpad" description="Call a number that is not a contact yet." />

      {inPlan && blockedReason !== null && (
        <Banner
          tone="warning"
          icon={Unplug}
          className="rounded-md"
          {...(perms.has('pbx:view_status')
            ? {
                action: {
                  label: 'PBX status',
                  onClick: () => {
                    void navigate({ to: '/settings', search: { section: 'telephony' } as never });
                  },
                },
              }
            : {})}
        >
          Dialling is unavailable. {blockedReason}
        </Banner>
      )}

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        {inPlan ? (
          <Panel>
            <Keypad value={digits} onChange={setDigits} />
          </Panel>
        ) : (
          <LockedKeypad />
        )}

        <div className="flex flex-col gap-4">
          {inPlan && debounced.length >= 4 && (
            <Panel title="Matching contacts" padded={false}>
              {matches.isPending ? (
                <div className="p-3">
                  <Skeleton height={48} shape="block" />
                </div>
              ) : (matches.data ?? []).length === 0 ? (
                <p className="px-3.5 py-3 text-sm text-muted">
                  No contact has a number like that. Calling will still work.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {(matches.data ?? []).map((c) => (
                    <li key={c.id}>
                      <Link
                        {...linkTo.contact(c.id)}
                        className="flex items-center gap-3 px-3.5 py-2.5 hover:bg-hover"
                      >
                        <Avatar name={c.displayName} seed={c.id} size={24} />
                        <span className="min-w-0 flex-1 truncate font-medium">{c.displayName}</span>
                        <span className="mono shrink-0 text-sm text-muted">
                          {c.primaryPhone === null ? '—' : formatPhone(c.primaryPhone)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}

          <Panel title="Your recent calls" padded={false}>
            {!perms.has('call:read') ? (
              <div className="p-3">
                <ForbiddenState permission="call:read" what="calls" compact />
              </div>
            ) : recent.isPending ? (
              <div className="p-3">
                <Skeleton height={120} shape="block" />
              </div>
            ) : (recent.data?.data ?? []).length === 0 ? (
              <EmptyState
                compact
                object="handset"
                title="No calls yet"
                description="Calls you make and take show up here for a quick redial."
              />
            ) : (
              <ul className="divide-y divide-border">
                {(recent.data?.data ?? []).map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-3.5 py-2.5">
                    <CallDirection direction={c.direction} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {c.contact?.displayName ??
                          c.externalDisplay ??
                          c.externalNumber ??
                          'Unknown'}
                      </span>
                      <span className="block truncate text-sm text-muted">
                        <DateTime value={c.startedAt} mode="relative" /> ·{' '}
                        <Duration seconds={c.talkDurationSec} />
                      </span>
                    </span>
                    <CallStatusBadge status={c.status} />
                    <IconButton
                      icon={Phone}
                      label={`Redial ${c.externalNumber ?? 'this number'}`}
                      size={26}
                      variant="ghost"
                      disabled={c.externalNumber === null || !dialer.available}
                      onClick={() => {
                        if (c.externalNumber === null) return;
                        dialer.dial({
                          e164: c.externalNumber,
                          contactId: c.contactId,
                          // From the call, so a number that is not on the contact still redials.
                          callId: c.id,
                          ...(c.contact !== null ? { contactName: c.contact.displayName } : {}),
                        });
                      }}
                    />
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {perms.has('pbx:view_status') && status.data !== undefined && (
            <p className={cn('mono text-xs', status.data.connected ? 'text-faint' : 'text-danger')}>
              PBX {status.data.connected ? 'connected' : 'disconnected'} · {status.data.liveCalls}{' '}
              live · {caps.myExtension === null ? 'no extension' : `ext ${caps.myExtension}`}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The keypad itself: a readout, the grid, and one call button.
 *
 * Controlled so the page can show matching contacts next to it and the dialog can drop it in
 * unchanged. Everything that decides whether a call can be placed lives in the shared dialer, and
 * the keys take the workspace's own accent, so a rebranded CRM has a rebranded pad.
 */
function Keypad({
  value,
  onChange,
  decorative = false,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Rendered as an illustration behind the padlock: it shows, it does not listen and cannot dial. */
  decorative?: boolean;
}) {
  const navigate = useNavigate();
  const settings = useSettings();
  const full = useFullSettings();
  const dialer = useDialer();
  const rules = (full.data as { dialRules?: DialRules } | undefined)?.dialRules ?? null;

  const press = useCallback(
    (key: string) => {
      if (value.length < 24) onChange(value + key);
    },
    [value, onChange],
  );
  const backspace = useCallback(() => {
    onChange(value.slice(0, -1));
  }, [value, onChange]);
  const place = useCallback(() => {
    const trimmed = value.trim();
    if (trimmed === '') return;
    dialer.dial({ e164: trimmed, display: trimmed });
  }, [value, dialer]);

  // The keypad answers to the real keyboard too, which is how anyone types a number quickly.
  useEffect(() => {
    if (decorative) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      if (/^[0-9*#+]$/.test(e.key)) {
        e.preventDefault();
        press(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        backspace();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        place();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [press, backspace, place, decorative]);

  const trimmed = value.trim();
  const dialable = trimmed === '' ? null : previewDialable(trimmed, rules, settings.defaultCountry);

  return (
    <div className="flex flex-col items-center gap-4">
      <Readout value={value} onChange={onChange} onBackspace={backspace} />

      <p className="mono min-h-4 text-center text-xs text-faint">
        {trimmed === ''
          ? 'Type, or use the keypad'
          : dialable !== null
            ? `Will dial ${dialable}`
            : 'The PBX dial rules decide the final string'}
      </p>

      <div className="grid grid-cols-3 gap-x-5 gap-y-3">
        {KEYS.map(([key, letters]) => (
          <Key key={key} digit={key} letters={letters} onPress={press} />
        ))}
      </div>

      <div className="mt-1 grid w-full grid-cols-[1fr_auto_1fr] items-center">
        <span className="justify-self-start">
          {value !== '' && (
            <IconButton
              icon={UserPlus}
              label="Save as a contact"
              size={32}
              variant="ghost"
              onClick={() => {
                void navigate({ to: '/contacts', search: { create: trimmed } as never });
              }}
            />
          )}
        </span>

        <button
          type="button"
          onClick={place}
          disabled={decorative || trimmed === '' || !dialer.available}
          title={dialer.reason ?? undefined}
          aria-label={trimmed === '' ? 'Call' : `Call ${trimmed}`}
          className={cn(
            'flex h-14 w-14 items-center justify-center rounded-full transition',
            'bg-[var(--flare)] text-[var(--on-flare)] shadow-sm',
            'hover:enabled:bg-[var(--flare-hover)] active:enabled:scale-95',
            'disabled:cursor-not-allowed disabled:bg-elevated disabled:text-faint disabled:shadow-none',
          )}
        >
          <Phone size={22} aria-hidden />
        </button>

        <span className="justify-self-end">
          {value !== '' && (
            <IconButton
              icon={Delete}
              label="Delete the last digit"
              size={32}
              variant="ghost"
              onClick={backspace}
            />
          )}
        </span>
      </div>
    </div>
  );
}

/**
 * The number as it is being built. A text input rather than a display so it can still be pasted
 * into and edited in the middle, with the type size a phone gives it.
 */
function Readout({
  value,
  onChange,
  onBackspace,
}: {
  value: string;
  onChange: (v: string) => void;
  onBackspace: () => void;
}) {
  return (
    <input
      value={value}
      inputMode="tel"
      autoComplete="off"
      spellCheck={false}
      aria-label="Number to call"
      placeholder="0712 345 678"
      onChange={(e) => {
        onChange(e.target.value.replace(/[^0-9*#+ ]/g, ''));
      }}
      onKeyDown={(e) => {
        // The document-level handler ignores inputs, so the field keeps its own backspace.
        if (
          e.key === 'Backspace' &&
          value !== '' &&
          e.currentTarget.selectionStart === value.length
        )
          return;
        if (e.key === 'Escape') onBackspace();
      }}
      className={cn(
        'mono w-full border-0 bg-transparent p-0 text-center text-2xl tracking-[0.04em] text-text',
        'placeholder:text-faint placeholder:tracking-normal focus:outline-none',
      )}
    />
  );
}

/** One key. Holding 0 gives a +, which is how every phone does it and how E.164 gets typed. */
function Key({
  digit,
  letters,
  onPress,
}: {
  digit: string;
  letters: string;
  onPress: (key: string) => void;
}) {
  const held = useRef(false);
  const timer = useRef<number | null>(null);
  const plus = digit === '0';

  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  return (
    <button
      type="button"
      aria-label={plus ? '0, hold for plus' : digit}
      onPointerDown={() => {
        held.current = false;
        if (!plus) return;
        timer.current = window.setTimeout(() => {
          held.current = true;
          onPress('+');
        }, 450);
      }}
      onPointerUp={clear}
      onPointerLeave={clear}
      onClick={() => {
        clear();
        if (!held.current) onPress(digit);
        held.current = false;
      }}
      className={cn(
        'flex h-14 w-14 select-none flex-col items-center justify-center rounded-full',
        'border border-border bg-surface transition',
        'hover:border-[var(--flare)] hover:bg-hover active:scale-95',
      )}
    >
      <span className="mono text-xl leading-none text-text">{digit}</span>
      {letters !== '' && (
        <span
          className={cn(
            'mt-0.5 leading-none text-faint',
            plus ? 'text-xs' : 'text-2xs tracking-[0.14em]',
          )}
        >
          {plus ? <Plus size={10} aria-hidden /> : letters}
        </span>
      )}
    </button>
  );
}

/**
 * The pad, visible but out of reach.
 *
 * Showing the real thing blurred rather than a description is deliberate: somebody who opened this
 * page wants the pad, and the fastest way to say what buying it gets them is to let them see it.
 * The copy underneath names who to ask, because nobody using the CRM can buy it themselves.
 */
function LockedKeypad() {
  const { ownerContact } = useEntitlements();
  const perms = usePermissions();

  return (
    <div className="relative overflow-hidden rounded-md border border-border bg-surface">
      {/* inert as well as hidden: a blurred field is still tabbable otherwise. */}
      <div inert aria-hidden className="pointer-events-none select-none p-4 opacity-60 blur-[3px]">
        <Keypad decorative value="0712 345 678" onChange={() => undefined} />
      </div>

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-bg/55 px-6 text-center backdrop-blur-[2px]">
        <span className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-elevated">
          <Lock size={18} className="text-muted" aria-hidden />
        </span>
        <p className="font-medium text-text">The dialpad is not part of your plan</p>
        <p className="text-sm text-muted">
          Dial any number, including one that is not a contact yet. To add it, contact{' '}
          {ownerContact.name} at{' '}
          <a href={`mailto:${ownerContact.email}`} className="whitespace-nowrap">
            {ownerContact.email}
          </a>
          .
        </p>
        {perms.has('settings:read') && (
          <a href="/settings?section=plan" className="text-sm">
            See your plan
          </a>
        )}
      </div>
    </div>
  );
}

/** The same pad in a dialog, for the button on the calls list. */
export function Dialpad({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [digits, setDigits] = useState('');
  const dialer = useDialer();
  const { features } = useEntitlements();

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Dialpad" width={340}>
      {!features.dialpad ? (
        <LockedKeypad />
      ) : (
        <>
          {dialer.reason !== null && <p className="mb-3 text-sm text-warning">{dialer.reason}</p>}
          <Keypad value={digits} onChange={setDigits} />
        </>
      )}
    </Dialog>
  );
}
