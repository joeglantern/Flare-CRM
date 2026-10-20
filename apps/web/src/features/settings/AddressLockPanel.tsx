/**
 * Settings, Security: lock the CRM to a list of addresses. Admin only.
 *
 * With the lock on, the CRM answers nobody outside the list, sign-in included; webhooks from the
 * phone system and WhatsApp and the public web forms stay open. The server refuses to switch it on
 * unless the admin's own address is on the list, so an admin cannot lock themselves out from here;
 * the way back in from the server is IP_ALLOWLIST_DISABLED.
 */
import { useQuery } from '@tanstack/react-query';
import { Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Input } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Toggle';
import { toast } from '@/components/ui/toast';
import { Panel } from '@/components/entity/EntityHeader';
import { http } from '@/lib/api/client';
import { errorMessage, isApiError } from '@/lib/api/errors';
import { usePermissions } from '@/providers/permissions';
import { useFullSettings } from '@/providers/settings';
import { useUpdateSettings } from './api';

interface Entry {
  value: string;
  label?: string;
}
interface Lock {
  enabled: boolean;
  entries: Entry[];
}

const ADDRESS = /^[0-9a-fA-F:.]+(\/\d{1,3})?$/;

export function AddressLockPanel() {
  const canManage = usePermissions().has('settings:manage');
  const full = useFullSettings();
  const saved = (full.data as { ipAllowlist?: Lock } | undefined)?.ipAllowlist ?? {
    enabled: false,
    entries: [],
  };
  const mine = useQuery({
    queryKey: ['settings', 'my-address'],
    queryFn: () => http.get<{ ip: string }>('/api/v1/settings/my-address'),
    enabled: canManage,
  });
  const update = useUpdateSettings();
  const [draft, setDraft] = useState<Lock | null>(null);
  const [value, setValue] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const lock = draft ?? saved;
  const myIp = mine.data?.ip ?? null;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(saved);

  const add = (v: string, l: string) => {
    const text = v.trim();
    if (!ADDRESS.test(text)) {
      setError('An address such as 102.205.237.244, or a range such as 41.90.0.0/16');
      return;
    }
    if (lock.entries.some((e) => e.value === text)) {
      setError('Already on the list');
      return;
    }
    setError(null);
    setDraft({
      ...lock,
      entries: [...lock.entries, { value: text, ...(l.trim() !== '' ? { label: l.trim() } : {}) }],
    });
    setValue('');
    setLabel('');
  };

  const save = (next: Lock) => {
    update.mutate(
      { ipAllowlist: next },
      {
        onSuccess: () => {
          setDraft(null);
          setConfirming(false);
          toast({
            tone: 'success',
            title: next.enabled ? 'The CRM is locked to these addresses' : 'Address list saved',
            description: next.enabled
              ? 'Anyone connecting from elsewhere is refused, and each refusal is in the audit log.'
              : 'The lock is off: every address can reach the sign-in page.',
          });
        },
        onError: (e) => {
          setConfirming(false);
          const issue = isApiError(e) ? e.fieldIssues[0]?.message : undefined;
          toast({ tone: 'danger', title: 'Not saved', description: issue ?? errorMessage(e) });
        },
      },
    );
  };

  const myAddressListed =
    myIp !== null && lock.entries.some((e) => e.value === myIp || e.value.includes('/'));

  return (
    <Panel
      title="Allowed IP addresses"
      note="lock the CRM to your office or VPN"
      actions={
        <Badge tone={saved.enabled ? 'success' : 'neutral'}>
          {saved.enabled ? 'Locked' : 'Off'}
        </Badge>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">
          With the lock on, nobody can sign in or use the CRM from an address that is not on this
          list. Calls and messages from the phone system and WhatsApp, and your public web forms,
          keep working. Refused attempts are written to the audit log.
          {myIp !== null && (
            <>
              {' '}
              You are connecting from <span className="mono text-text">{myIp}</span>.
            </>
          )}
        </p>

        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {lock.entries.length === 0 ? (
            <li className="px-3 py-2 text-sm text-faint">No addresses yet.</li>
          ) : (
            lock.entries.map((e) => (
              <li key={e.value} className="flex items-center gap-2 px-3 py-1.5">
                <span className="mono text-base">{e.value}</span>
                {e.label !== undefined && <span className="text-sm text-muted">{e.label}</span>}
                {e.value === myIp && <Badge tone="neutral">you</Badge>}
                {canManage && (
                  <IconButton
                    icon={Trash2}
                    label={`Remove ${e.value}`}
                    size={26}
                    variant="ghost"
                    className="ml-auto"
                    onClick={() => {
                      setDraft({
                        ...lock,
                        entries: lock.entries.filter((x) => x.value !== e.value),
                      });
                    }}
                  />
                )}
              </li>
            ))
          )}
        </ul>

        {canManage && (
          <>
            <form
              className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                add(value, label);
              }}
            >
              <Input
                label="Address or range"
                mono
                placeholder="102.205.237.244 or 41.90.0.0/16"
                value={value}
                error={error ?? undefined}
                onChange={(e) => {
                  setValue(e.target.value);
                  setError(null);
                }}
              />
              <Input
                label="Label"
                placeholder="Head office"
                value={label}
                onChange={(e) => {
                  setLabel(e.target.value);
                }}
              />
              <div className="flex items-end">
                <Button type="submit" variant="secondary" icon={Plus}>
                  Add
                </Button>
              </div>
            </form>
            {myIp !== null && !lock.entries.some((e) => e.value === myIp) && (
              <div>
                <Button
                  variant="ghost"
                  icon={Plus}
                  onClick={() => {
                    add(myIp, 'My address');
                  }}
                >
                  Add my address ({myIp})
                </Button>
              </div>
            )}

            <Switch
              checked={lock.enabled}
              onChange={(enabled) => {
                setDraft({ ...lock, enabled });
              }}
              label="Only allow these addresses"
              description="Your own address has to be on the list before this can be saved."
            />

            <div className="flex justify-end gap-2">
              {dirty && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setDraft(null);
                    setError(null);
                  }}
                >
                  Cancel
                </Button>
              )}
              <Button
                variant="primary"
                icon={ShieldCheck}
                disabled={!dirty}
                loading={update.isPending}
                onClick={() => {
                  if (lock.enabled && !saved.enabled) setConfirming(true);
                  else save(lock);
                }}
              >
                Save
              </Button>
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        tone="danger"
        title="Lock the CRM to these addresses?"
        description="From now on the CRM refuses anyone connecting from an address that is not on the list, people already signed in included."
        consequences={[
          'Agents working from home or on mobile data are refused unless their address is listed.',
          myAddressListed
            ? 'Your own address is covered, so you stay signed in.'
            : 'Your own address does not appear to be on the list; the save will be refused.',
          'If everyone is locked out, it can only be lifted from the server.',
        ]}
        typedConfirmation="LOCK"
        confirmLabel="Lock it"
        loading={update.isPending}
        onConfirm={() => {
          save(lock);
        }}
      />
    </Panel>
  );
}
