/**
 * Settings, Your plan: the owner console link (docs/21 section 4). Admin only.
 *
 * An admin pastes the block the provider's console printed for this stack, or types the four
 * values. The server checks them with the console before storing anything. The secret field is
 * write-only: it is never filled in from the server, because the server never sends it back.
 */
import {
  consoleLinkEnrollBody,
  type ConsoleLinkEnrollBody,
  type ConsoleLinkStatusDto,
} from '@crm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Link2 } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { toast } from '@/components/ui/toast';
import { DateTime } from '@/components/data/formatters';
import { Panel } from '@/components/entity/EntityHeader';
import { http } from '@/lib/api/client';
import { errorMessage, isApiError } from '@/lib/api/errors';
import { qk } from '@/lib/query';
import { parseConsoleLines, type ConsoleLinkValues } from './console-lines';

const EMPTY: ConsoleLinkValues = { consoleUrl: '', stackId: '', stackSecret: '', publicKey: '' };
const STATUS_KEY = ['console-link'] as const;

export function ConsoleLinkCard() {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: STATUS_KEY,
    queryFn: () => http.get<ConsoleLinkStatusDto>('/api/v1/console-link'),
  });
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ConsoleLinkValues>(EMPTY);
  const [paste, setPaste] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: (body: ConsoleLinkEnrollBody) =>
      http.put<ConsoleLinkStatusDto>('/api/v1/console-link', body),
    onSuccess: (next) => {
      qc.setQueryData(STATUS_KEY, next);
      void qc.invalidateQueries({ queryKey: qk.entitlements() });
      setForm(EMPTY);
      setPaste('');
      setErrors({});
      setEditing(false);
      toast({
        tone: 'success',
        title: 'Linked to the console',
        description: 'The plan from your provider will arrive in a few seconds.',
      });
    },
    onError: (err) => {
      if (isApiError(err) && err.fieldIssues.length > 0) {
        setErrors(Object.fromEntries(err.fieldIssues.map((i) => [i.path, i.message])));
        return;
      }
      toast({ tone: 'danger', title: 'Not linked', description: errorMessage(err) });
    },
  });

  const s = status.data;
  const fromServer = s?.managedBy === 'server';

  const submit = () => {
    const parsed = consoleLinkEnrollBody.safeParse(form);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  };

  const field = (key: keyof ConsoleLinkValues) => ({
    name: key,
    value: form[key],
    error: errors[key],
    onChange: (e: { target: { value: string } }) => {
      setForm((f) => ({ ...f, [key]: e.target.value }));
    },
  });

  return (
    <Panel title="Owner console link">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {s === undefined ? (
            <span className="text-muted">Loading…</span>
          ) : s.managedBy === null ? (
            <Badge tone="neutral">Not linked</Badge>
          ) : s.connected ? (
            <Badge tone="success">Connected</Badge>
          ) : (
            <Badge tone="warning">Linked, not connected</Badge>
          )}
          {s?.stackId != null && <span className="mono text-muted">{s.stackId}</span>}
          {s?.consoleUrl != null && <span className="truncate text-muted">{s.consoleUrl}</span>}
          {s?.lastHeartbeatAt != null && (
            <span className="text-faint">
              last heard <DateTime value={s.lastHeartbeatAt} />
            </span>
          )}
        </div>

        {fromServer ? (
          <p className="text-sm text-muted">
            This link is set on the server, so it can only be changed there.
          </p>
        ) : !editing ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={s?.managedBy === null ? 'primary' : 'secondary'}
              icon={s?.managedBy === null ? Link2 : KeyRound}
              onClick={() => {
                setEditing(true);
              }}
            >
              {s?.managedBy === null ? 'Link to the console' : 'Replace the stack secret'}
            </Button>
            <span className="text-sm text-faint">
              Use the four values your provider gave you for this workspace.
            </span>
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
            <Textarea
              label="Paste what the console gave you"
              description="The four CONSOLE_ lines. The fields below fill in from it."
              rows={4}
              className="mono"
              spellCheck={false}
              value={paste}
              onChange={(e) => {
                setPaste(e.target.value);
                const found = parseConsoleLines(e.target.value);
                if (Object.keys(found).length > 0) setForm((f) => ({ ...f, ...found }));
              }}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Console address" placeholder="https://" {...field('consoleUrl')} />
              <Input label="Stack id" mono placeholder="stk_" {...field('stackId')} />
            </div>
            <Input
              label="Stack secret"
              type="password"
              mono
              autoComplete="new-password"
              description="Stored encrypted. It is never shown again, here or anywhere."
              {...field('stackSecret')}
            />
            <Input
              label="Console public key"
              mono
              description={
                s !== undefined && s.trustedKeyIds.length > 0
                  ? 'Must be the key this workspace already trusts.'
                  : 'Checks that plans really come from your provider.'
              }
              {...field('publicKey')}
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                disabled={save.isPending}
                onClick={() => {
                  setEditing(false);
                  setForm(EMPTY);
                  setPaste('');
                  setErrors({});
                }}
              >
                Cancel
              </Button>
              <Button variant="primary" type="submit" loading={save.isPending}>
                Check and link
              </Button>
            </div>
          </form>
        )}
      </div>
    </Panel>
  );
}
