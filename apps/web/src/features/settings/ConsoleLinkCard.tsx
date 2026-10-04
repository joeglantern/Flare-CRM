/**
 * Settings, Console link: the owner console link (docs/21 section 4). Admin only.
 *
 * An admin pastes the block the provider's console printed for this stack, or types the four
 * values. The server checks them with the console before storing anything. The secret and the
 * console's address are write-only: neither is ever sent to the browser, so on an existing link a
 * blank field means "keep the one in use".
 *
 * Editing a working link can cut the workspace off from its plan, so the form says so up front,
 * and a change of address, stack id or public key has to be confirmed by typing a word. The server
 * enforces the same confirmation; this screen only asks for it first.
 */
import {
  consoleLinkEnrollBody,
  type ConsoleLinkEnrollBody,
  type ConsoleLinkSaveResult,
  type ConsoleLinkStatusDto,
} from '@crm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, Pencil, RotateCcw, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Input, Textarea } from '@/components/ui/Input';
import { toast } from '@/components/ui/toast';
import { DateTime } from '@/components/data/formatters';
import { Panel } from '@/components/entity/EntityHeader';
import { http } from '@/lib/api/client';
import { errorMessage, isApiError } from '@/lib/api/errors';
import { qk } from '@/lib/query';
import { linkChanges, parseConsoleLines, type ConsoleLinkValues } from './console-lines';

const EMPTY: ConsoleLinkValues = { consoleUrl: '', stackId: '', stackSecret: '', publicKey: '' };
const STATUS_KEY = ['console-link'] as const;
const CONFIRM_WORD = 'CHANGE';

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
  // The changes waiting on the typed confirmation; null while no confirmation is open.
  const [confirming, setConfirming] = useState<string[] | null>(null);
  const [resetOpen, setResetOpen] = useState(false);

  const s = status.data;
  const linked = s !== undefined && s.managedBy !== null;

  const close = () => {
    setEditing(false);
    setForm(EMPTY);
    setPaste('');
    setErrors({});
    setConfirming(null);
  };

  const save = useMutation({
    mutationFn: (body: ConsoleLinkEnrollBody) =>
      http.put<ConsoleLinkSaveResult>('/api/v1/console-link', body),
    onSuccess: (next) => {
      const { keyVerified, ...rest } = next;
      qc.setQueryData(STATUS_KEY, rest);
      void qc.invalidateQueries({ queryKey: qk.entitlements() });
      close();
      toast({
        tone: 'success',
        title: 'Console link saved',
        description: keyVerified
          ? 'The console accepted the details and its plan is signed with this key.'
          : 'The console accepted the stack id and secret. The key is checked when the next plan arrives.',
      });
    },
    onError: (err) => {
      setConfirming(null);
      if (isApiError(err) && err.fieldIssues.length > 0) {
        const issues = Object.fromEntries(err.fieldIssues.map((i) => [i.path, i.message]));
        // The server saw a change this screen did not; ask, then send again.
        if (issues.confirmChange !== undefined) {
          setConfirming(['This points the workspace at a different console.']);
          return;
        }
        setErrors(issues);
        return;
      }
      toast({ tone: 'danger', title: 'Not saved', description: errorMessage(err) });
    },
  });

  const reset = useMutation({
    mutationFn: () => http.del<ConsoleLinkStatusDto>('/api/v1/console-link'),
    onSuccess: (next) => {
      qc.setQueryData(STATUS_KEY, next);
      void qc.invalidateQueries({ queryKey: qk.entitlements() });
      setResetOpen(false);
      close();
      toast({ tone: 'success', title: 'Back on the link set on the server' });
    },
    onError: (err) => {
      setResetOpen(false);
      toast({ tone: 'danger', title: 'Not changed', description: errorMessage(err) });
    },
  });

  const validated = (): ConsoleLinkEnrollBody | null => {
    const parsed = consoleLinkEnrollBody.safeParse(form);
    const found: Record<string, string> = parsed.success
      ? {}
      : Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message]));
    // A first link has nothing to keep, so both write-only fields are needed.
    if (!linked) {
      if (form.consoleUrl.trim() === '') found.consoleUrl = 'Enter the console address';
      if (form.stackSecret.trim() === '') found.stackSecret = 'Enter the stack secret';
    }
    setErrors(found);
    return parsed.success && Object.keys(found).length === 0 ? parsed.data : null;
  };

  const submit = () => {
    const body = validated();
    if (body === null || s === undefined) return;
    const changes = linked ? linkChanges(s, form) : [];
    if (changes.length > 0) setConfirming(changes);
    else save.mutate(body);
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
          {s?.managedBy === 'server' && <span className="text-faint">set on the server</span>}
          {s?.managedBy === 'admin' && <span className="text-faint">saved here</span>}
          {s?.lastHeartbeatAt != null && (
            <span className="text-faint">
              last heard <DateTime value={s.lastHeartbeatAt} />
            </span>
          )}
        </div>

        {s?.locked === true ? (
          <p className="text-sm text-muted">
            This link is locked on the server, so it can only be changed there.
          </p>
        ) : !editing ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={linked ? 'secondary' : 'primary'}
              icon={linked ? Pencil : Link2}
              disabled={s === undefined}
              onClick={() => {
                setForm(
                  linked
                    ? { ...EMPTY, stackId: s.stackId ?? '', publicKey: s.publicKeys[0] ?? '' }
                    : EMPTY,
                );
                setEditing(true);
              }}
            >
              {linked ? 'Edit the link' : 'Link to the console'}
            </Button>
            {s?.managedBy === 'admin' && s.serverLinkAvailable && (
              <Button
                variant="ghost"
                icon={RotateCcw}
                onClick={() => {
                  setResetOpen(true);
                }}
              >
                Go back to the server link
              </Button>
            )}
            <span className="text-sm text-faint">
              {linked
                ? 'The address and the secret are never shown. Everything is checked with the console before it is saved.'
                : 'Use the four values your provider gave you for this workspace.'}
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
            {linked && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-md bg-[var(--warning-subtle)] p-3 text-sm"
              >
                <TriangleAlert size={14} className="mt-0.5 shrink-0 text-warning" aria-hidden />
                <div className="flex flex-col gap-1">
                  <span className="font-medium">This workspace is already linked.</span>
                  <span className="text-muted">
                    Its plan, features and limits come over this link, and wrong details can cut it
                    off from them. Leave the address and the secret blank to keep the ones in use.
                    Changing the address, the stack id or the public key moves the workspace to a
                    different console and has to be confirmed.
                  </span>
                </div>
              </div>
            )}
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
              <Input
                label="Console address"
                placeholder={linked ? 'Blank keeps the current address' : 'https://'}
                description={
                  linked ? 'Not shown, for security. Type one only to change it.' : undefined
                }
                {...field('consoleUrl')}
              />
              <Input label="Stack id" mono placeholder="stk_" {...field('stackId')} />
            </div>
            <Input
              label="Stack secret"
              type="password"
              mono
              autoComplete="new-password"
              placeholder={linked ? 'Blank keeps the current secret' : undefined}
              description="Stored encrypted. It is never shown again, here or anywhere."
              {...field('stackSecret')}
            />
            <Input
              label="Console public key"
              mono
              description="Checks that plans really come from your provider."
              {...field('publicKey')}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" disabled={save.isPending} onClick={close}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" loading={save.isPending}>
                {linked ? 'Check and save' : 'Check and link'}
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
        title="Move this workspace to a different console?"
        description="The new details are checked with that console first, and nothing is saved if it does not accept them. Once saved, this takes effect at once for everyone."
        consequences={confirming ?? []}
        typedConfirmation={CONFIRM_WORD}
        confirmLabel="Change the link"
        loading={save.isPending}
        onConfirm={() => {
          const body = validated();
          if (body === null) {
            setConfirming(null);
            return;
          }
          save.mutate({ ...body, confirmChange: true });
        }}
      />
      <ConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        tone="primary"
        title="Go back to the server link?"
        description="The link saved here is removed, and the workspace goes back to the one set on the server."
        confirmLabel="Use the server link"
        loading={reset.isPending}
        onConfirm={() => {
          reset.mutate();
        }}
      />
    </Panel>
  );
}
