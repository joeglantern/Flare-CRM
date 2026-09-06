/**
 * DialButton and DialDialog (Component Inventory · Telephony), used in 30+ places.
 *
 * The confirmation shows the literal dialable string, which is what makes a prefix
 * misconfiguration obvious on the first try (Flows · Click to dial). Do-not-call is blocked here
 * with an override only for `contact:override_dnc`, and every dial control is disabled with a
 * reason when the PBX is disconnected.
 */
import { Ban, Phone, Unplug } from 'lucide-react';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { Button, IconButton } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Overlay';
import { Tooltip } from '@/components/ui/Tooltip';
import { toast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/api/errors';
import { formatPhone } from '@/lib/format';
import { usePermissions } from '@/providers/permissions';
import { useSettings } from '@/providers/settings';
import { useFullSettings } from '@/providers/settings';
import { previewDialable, useCapabilities, useCtiStatus, useDial, type DialRules } from './api';

export interface DialTarget {
  e164: string;
  display?: string;
  contactId?: string | null;
  phoneId?: string | null;
  contactName?: string;
  contactCompany?: string | null;
  phoneType?: string | null;
  primary?: boolean;
  doNotCall?: boolean;
  dncSetBy?: string | null;
}

interface DialerApi {
  /** Opens the confirmation dialog. */
  dial: (target: DialTarget) => void;
  available: boolean;
  reason: string | null;
  canDial: boolean;
}

const DialerContext = createContext<DialerApi | null>(null);

export function DialerProvider({ children }: { children: ReactNode }) {
  const caps = useCapabilities();
  const perms = usePermissions();
  const status = useCtiStatus(perms.has('pbx:view_status'));
  const [target, setTarget] = useState<DialTarget | null>(null);

  const canDial = perms.has('call:dial');
  const connected = caps.enabled && (status.data?.connected ?? caps.dial);
  const reason = !caps.enabled
    ? 'Telephony is not enabled'
    : !canDial
      ? 'Requires call:dial'
      : caps.myExtension === null
        ? 'You have no extension. Ask an admin to set one.'
        : !connected
          ? 'PBX disconnected'
          : null;

  const value = useMemo<DialerApi>(
    () => ({
      dial: (t) => {
        setTarget(t);
      },
      available: reason === null,
      reason,
      canDial,
    }),
    [reason, canDial],
  );

  return (
    <DialerContext value={value}>
      {children}
      <DialDialog
        target={target}
        onClose={() => {
          setTarget(null);
        }}
      />
    </DialerContext>
  );
}

export function useDialer(): DialerApi {
  return (
    useContext(DialerContext) ?? {
      dial: () => undefined,
      available: false,
      reason: 'Telephony is not available here',
      canDial: false,
    }
  );
}

export function DialButton({
  target,
  size = 26,
  variant = 'secondary',
  label,
}: {
  target: DialTarget;
  size?: 26 | 28 | 32;
  variant?: 'ghost' | 'secondary';
  label?: string;
}) {
  const dialer = useDialer();
  const perms = usePermissions();
  // No permission at all: the number stays visible and copyable, but no control renders.
  if (!dialer.canDial) return null;
  const blocked = target.doNotCall === true && !perms.has('contact:override_dnc');
  const disabled = !dialer.available || blocked;
  const why = blocked ? 'Do not call: this contact is flagged' : dialer.reason;
  return (
    <Tooltip content={why ?? `Call ${target.display ?? formatPhone(target.e164)}`}>
      <IconButton
        icon={blocked ? Ban : dialer.available ? Phone : Unplug}
        label={label ?? `Call ${target.display ?? formatPhone(target.e164)}`}
        size={size}
        variant={variant}
        disabled={disabled}
        onClick={() => {
          dialer.dial(target);
        }}
      />
    </Tooltip>
  );
}

function DialDialog({ target, onClose }: { target: DialTarget | null; onClose: () => void }) {
  const dial = useDial();
  const settings = useSettings();
  const perms = usePermissions();
  const full = useFullSettings();
  const caps = useCapabilities();
  const rules = (full.data as { dialRules?: DialRules } | undefined)?.dialRules ?? null;
  const blocked = target?.doNotCall === true;
  const canOverride = perms.has('contact:override_dnc');

  if (target === null) return null;
  const dialable = previewDialable(target.e164, rules, settings.defaultCountry);

  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      title={
        blocked
          ? 'This contact must not be called'
          : `Call ${target.contactName ?? formatPhone(target.e164)}`
      }
      description={
        blocked
          ? undefined
          : [target.contactCompany, target.phoneType, target.primary === true ? 'primary' : null]
              .filter(Boolean)
              .join(' · ') || undefined
      }
      width={440}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {(!blocked || canOverride) && (
            <Button
              variant="primary"
              icon={Phone}
              loading={dial.isPending}
              onClick={() => {
                dial.mutate(
                  {
                    ...(target.contactId != null ? { contactId: target.contactId } : {}),
                    ...(target.phoneId != null
                      ? { phoneId: target.phoneId }
                      : { number: target.e164 }),
                  },
                  {
                    onSuccess: () => {
                      onClose();
                    },
                    onError: (e) => {
                      toast({
                        tone: 'danger',
                        title: 'Could not dial',
                        description: errorMessage(e),
                      });
                    },
                  },
                );
              }}
            >
              {blocked ? 'Dial anyway' : 'Call now'}
            </Button>
          )}
        </>
      }
    >
      {blocked ? (
        <div className="flex flex-col gap-3 text-base">
          <p className="flex items-start gap-2 rounded-md bg-[var(--danger-subtle)] p-3">
            <Ban size={14} className="mt-0.5 shrink-0 text-danger" aria-hidden />
            <span>
              {target.contactName ?? formatPhone(target.e164)} is flagged do-not-call
              {target.dncSetBy != null && ` by ${target.dncSetBy}`}. Outbound calls are blocked.
            </span>
          </p>
          {canOverride ? (
            <p className="text-sm text-muted">
              You may override this. The override is written to the audit log with your name.
            </p>
          ) : (
            <p className="text-sm text-muted">
              Requires <span className="mono">contact:override_dnc</span> to dial anyway.
            </p>
          )}
        </div>
      ) : (
        <dl className="grid grid-cols-[92px_1fr] gap-x-3 gap-y-2 text-base">
          <dt className="text-sm text-muted">Number</dt>
          <dd>{formatPhone(target.e164, settings.defaultCountry as never)}</dd>
          <dt className="text-sm text-muted">Will dial</dt>
          <dd className="mono">
            {dialable ?? <span className="text-faint">set by the PBX dial rules</span>}
          </dd>
          <dt className="text-sm text-muted">From</dt>
          <dd className="mono">ext {caps.myExtension ?? '—'}</dd>
        </dl>
      )}
    </Dialog>
  );
}
