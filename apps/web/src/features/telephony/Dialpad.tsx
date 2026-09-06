/**
 * Dialpad (Calls · Dialpad). A keypad for numbers that are not yet contacts, plus a
 * recent-calls strip so redialling does not mean going back to the list.
 *
 * What it will actually dial is shown under the field before the call is placed, because a wrong
 * outbound prefix is the failure that otherwise only shows up as silence on the line.
 * Every control is disabled with the reason when the PBX is disconnected or the user has no
 * extension. The dial itself goes through the shared dialer so the confirmation is identical
 * everywhere in the app.
 */
import { Delete, Phone, Unplug, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button, IconButton } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
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
  const [digits, setDigits] = useState('');

  const debounced = useDebounced(digits, 300);
  const matches = useContactSearch(debounced.length >= 4 ? debounced : '');

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

      {blockedReason !== null && (
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

      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <Panel>
          <Keypad value={digits} onChange={setDigits} />
        </Panel>

        <div className="flex flex-col gap-4">
          {debounced.length >= 4 && (
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

          <Panel title="Your recent calls" note="GET /calls?mine=true" padded={false}>
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
 * The keypad itself: field, live "will dial" preview, grid and the call button.
 *
 * Controlled so the page can show matching contacts next to it and the dialog can drop it in
 * unchanged. Everything that decides whether a call can be placed lives in the shared dialer.
 */
function Keypad({ value, onChange }: { value: string; onChange: (v: string) => void }) {
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
  }, [press, backspace, place]);

  const dialable =
    value.trim() === '' ? null : previewDialable(value.trim(), rules, settings.defaultCountry);

  return (
    <div className="flex flex-col gap-3">
      <Input
        value={value}
        onChange={(e) => {
          onChange(e.target.value.replace(/[^0-9*#+ ]/g, ''));
        }}
        placeholder="0712 345 678"
        aria-label="Number to call"
        mono
        suffix={
          value === '' ? undefined : (
            <IconButton
              icon={Delete}
              label="Delete the last digit"
              size={26}
              variant="ghost"
              onClick={backspace}
            />
          )
        }
      />

      <p className="mono min-h-4 text-xs text-faint">
        {value.trim() === ''
          ? 'Type or click the keypad'
          : dialable !== null
            ? `Will dial ${dialable}`
            : 'The PBX dial rules decide the final string'}
      </p>

      <div className="grid grid-cols-3 gap-2">
        {KEYS.map(([key, letters]) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              press(key);
            }}
            className="flex h-14 flex-col items-center justify-center rounded-md border border-border bg-surface hover:border-border-strong hover:bg-hover"
          >
            <span className="mono text-lg leading-none">{key}</span>
            {letters !== '' && <span className="mt-0.5 text-xs text-faint">{letters}</span>}
          </button>
        ))}
      </div>

      <Button
        variant="primary"
        icon={Phone}
        disabled={value.trim() === '' || !dialer.available}
        onClick={place}
      >
        Call
      </Button>

      {value !== '' && (
        <Button
          variant="ghost"
          size="sm"
          icon={UserPlus}
          onClick={() => {
            void navigate({ to: '/contacts', search: { create: value.trim() } as never });
          }}
        >
          Save as a contact
        </Button>
      )}
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Dialpad" width={320}>
      {dialer.reason !== null && <p className="mb-3 text-sm text-warning">{dialer.reason}</p>}
      <Keypad value={digits} onChange={setDigits} />
    </Dialog>
  );
}
