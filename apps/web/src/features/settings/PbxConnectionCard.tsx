/**
 * Settings, Telephony: which PBX the CRM talks to, and with which API key. Admin only.
 *
 * Saving asks the PBX for a token with the new details and stores nothing it refuses. The client
 * secret is write-only, so a blank field keeps the one in use for the same PBX and client ID.
 * A save reconnects the phone system for everyone, which takes a few seconds, so it is confirmed
 * first; the server refuses the change without that confirmation.
 */
import { pbxConfigBody, type PbxConfigBody, type PbxStatusDto } from '@crm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, RotateCcw, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Toggle';
import { toast } from '@/components/ui/toast';
import { DateTime } from '@/components/data/formatters';
import { Panel } from '@/components/entity/EntityHeader';
import { http } from '@/lib/api/client';
import { errorMessage, isApiError } from '@/lib/api/errors';
import { qk } from '@/lib/query';

const KEY = ['integrations', 'pbx'] as const;

interface Form {
  enabled: boolean;
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  tls: 'public' | 'fingerprint';
  fingerprint: string;
}

export function PbxConnectionCard() {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: KEY,
    queryFn: () => http.get<PbxStatusDto>('/api/v1/integrations/pbx'),
    refetchInterval: 15_000,
  });
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<PbxConfigBody | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const s = status.data;

  const afterChange = (next: PbxStatusDto) => {
    qc.setQueryData(KEY, next);
    // The connection drops and comes back; the sidebar and banners catch up from these.
    setTimeout(() => {
      void qc.invalidateQueries({ queryKey: qk.cti() });
      void qc.invalidateQueries({ queryKey: KEY });
    }, 8_000);
  };

  const save = useMutation({
    mutationFn: (body: PbxConfigBody) => http.put<PbxStatusDto>('/api/v1/integrations/pbx', body),
    onSuccess: (next) => {
      afterChange(next);
      setForm(null);
      setConfirming(null);
      setErrors({});
      toast({
        tone: 'success',
        title: 'PBX settings saved',
        description: 'The PBX accepted them. The CRM is reconnecting, which takes a few seconds.',
      });
    },
    onError: (err) => {
      setConfirming(null);
      if (isApiError(err) && err.fieldIssues.length > 0) {
        setErrors(Object.fromEntries(err.fieldIssues.map((i) => [i.path, i.message])));
        return;
      }
      toast({ tone: 'danger', title: 'Not saved', description: errorMessage(err) });
    },
  });
  const reset = useMutation({
    mutationFn: () => http.del<PbxStatusDto>('/api/v1/integrations/pbx'),
    onSuccess: (next) => {
      afterChange(next);
      setResetOpen(false);
      toast({
        tone: 'success',
        title: 'Back on the server settings',
        description: 'Reconnecting.',
      });
    },
    onError: (err) => {
      setResetOpen(false);
      toast({ tone: 'danger', title: 'Not changed', description: errorMessage(err) });
    },
  });

  const submit = () => {
    if (form === null) return;
    const parsed = pbxConfigBody.safeParse(form);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
      return;
    }
    setErrors({});
    setConfirming(parsed.data);
  };

  const field = (key: 'baseUrl' | 'clientId' | 'clientSecret' | 'fingerprint') => ({
    name: key,
    value: form?.[key] ?? '',
    error: errors[key],
    onChange: (e: { target: { value: string } }) => {
      setForm((f) => (f === null ? f : { ...f, [key]: e.target.value }));
      setErrors(({ [key]: _fixed, ...rest }) => rest);
    },
  });

  return (
    <Panel title="PBX connection" note="the Yeastar address and API key the CRM uses">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {s === undefined ? (
            <span className="text-muted">Loading…</span>
          ) : (
            <>
              {!s.enabled ? (
                <Badge tone="neutral">Off</Badge>
              ) : s.connected ? (
                <Badge tone="success">Connected</Badge>
              ) : (
                <Badge tone="warning">Not connected</Badge>
              )}
              <span className="text-faint">
                {s.source === 'admin' ? 'set here' : 'set on the server'}
              </span>
              {s.baseUrl !== null && <span className="mono text-muted">{s.baseUrl}</span>}
              {s.clientId !== null && (
                <span className="text-muted">
                  client <span className="mono">{s.clientId}</span>
                </span>
              )}
              {s.updatedAt !== null && (
                <span className="text-faint">
                  saved <DateTime value={s.updatedAt} mode="relative" />
                </span>
              )}
            </>
          )}
        </div>

        {form === null ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              icon={Pencil}
              disabled={s === undefined}
              onClick={() => {
                setErrors({});
                setForm({
                  enabled: s?.enabled ?? true,
                  baseUrl: s?.baseUrl ?? '',
                  clientId: s?.clientId ?? '',
                  clientSecret: '',
                  tls: s?.tls ?? 'public',
                  fingerprint: s?.fingerprint ?? '',
                });
              }}
            >
              Edit the connection
            </Button>
            {s?.source === 'admin' && (
              <Button
                variant="ghost"
                icon={RotateCcw}
                onClick={() => {
                  setResetOpen(true);
                }}
              >
                Go back to the server settings
              </Button>
            )}
          </div>
        ) : (
          <form
            className="flex flex-col gap-3"
            noValidate
            autoComplete="off"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-md bg-[var(--warning-subtle)] p-3 text-sm"
            >
              <TriangleAlert size={14} className="mt-0.5 shrink-0 text-warning" aria-hidden />
              <span className="text-muted">
                Call popups, click to call and call logging all run over this connection. Saving
                reconnects them for everyone, and wrong details stop them until they are fixed.
                Everything is checked with the PBX before it is saved.
              </span>
            </div>
            <Switch
              checked={form.enabled}
              onChange={(enabled) => {
                setForm((f) => (f === null ? f : { ...f, enabled }));
              }}
              label="Connect to the PBX"
              description="Off stops call popups, click to call and call logging."
            />
            <Input
              label="PBX address"
              mono
              placeholder="https://yourcompany.ras.yeastar.com"
              description="The address you open the PBX web page at, with https://"
              {...field('baseUrl')}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="API client ID"
                mono
                description="PBX: Integrations, API, Client ID."
                {...field('clientId')}
              />
              <Input
                label="API client secret"
                type="password"
                mono
                autoComplete="new-password"
                placeholder={s?.secretSet === true ? 'Blank keeps the current one' : undefined}
                description="Stored encrypted. It is never shown again."
                {...field('clientSecret')}
              />
            </div>
            <Select
              label="Certificate"
              value={form.tls}
              onChange={(v) => {
                setForm((f) => (f === null ? f : { ...f, tls: v as Form['tls'] }));
              }}
              options={[
                {
                  value: 'public',
                  label: 'Public certificate',
                  description: 'Yeastar Cloud and Remote Access addresses',
                },
                {
                  value: 'fingerprint',
                  label: 'Self-signed, trusted by fingerprint',
                  description: 'A PBX on your own network',
                },
              ]}
            />
            {form.tls === 'fingerprint' && (
              <Input
                label="Certificate fingerprint (SHA-256)"
                mono
                placeholder="AA:BB:CC:…"
                {...field('fingerprint')}
              />
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                disabled={save.isPending}
                onClick={() => {
                  setForm(null);
                  setErrors({});
                }}
              >
                Cancel
              </Button>
              <Button variant="primary" type="submit" loading={save.isPending}>
                Check and save
              </Button>
            </div>
          </form>
        )}
      </div>

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        tone="primary"
        title="Reconnect the phone system?"
        description="The PBX is asked to accept these details first; nothing is saved if it refuses. Once saved, the CRM reconnects for everyone, which takes a few seconds."
        consequences={[
          'Call popups and click to call pause while it reconnects.',
          'A call in progress carries on, but may be logged a little later.',
        ]}
        confirmLabel="Save and reconnect"
        loading={save.isPending}
        onConfirm={() => {
          if (confirming !== null) save.mutate({ ...confirming, confirmReconnect: true });
        }}
      />
      <ConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        tone="primary"
        title="Go back to the server settings?"
        description="The PBX details saved here are removed and the CRM reconnects with the ones set on the server."
        confirmLabel="Use the server settings"
        loading={reset.isPending}
        onConfirm={() => {
          reset.mutate();
        }}
      />
    </Panel>
  );
}
