/**
 * One server, in detail: what it says about itself, what it has been doing, and what has been sent
 * to it.
 *
 * The actions are ordered by how much they cost. Asking it to report in changes nothing. Sending its
 * document again changes nothing about what was agreed. Rolling the secret disconnects it until
 * somebody edits a file on that machine, and refusing it is the end of the line, so those two say
 * what they cost before they happen.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Check, Radio, RefreshCw, Send, ShieldOff, Stethoscope, X } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, ConfirmDialog, Input, Textarea, toast } from '@crm/ui';

import {
  CopyLine,
  Field,
  Fields,
  IssueStatusBadge,
  Pager,
  StatusDot,
  Table,
} from '@/components/Bits';
import { EmptyState, PageHeader, Section, StateSlot } from '@/components/Page';
import { stackRoute } from '@/app/router';
import { http } from '@/lib/api';
import { ago, bytes, count, dateTime } from '@/lib/format';
import { usePermissions } from '@/lib/permissions';
import { qk } from '@/lib/query';
import type { Issue, StackDiagnostics, StackRow, StackSample } from '@/lib/types';

const ISSUES_PER_PAGE = 10;
const SAMPLE_HOURS = 24;

export function StackScreen() {
  const { stackId } = stackRoute.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const mayOperate = can('stack:operate');
  const mayManage = can('stack:manage');
  const [confirming, setConfirming] = useState<'rotate' | 'revoke' | null>(null);
  const [issuePage, setIssuePage] = useState(1);

  const stack = useQuery({
    queryKey: qk.stack(stackId),
    queryFn: () => http.get<StackRow>(`/api/v1/stacks/${stackId}`),
  });

  const issues = useQuery({
    queryKey: qk.stackIssues(stackId, issuePage),
    queryFn: () =>
      http.list<Issue>(`/api/v1/stacks/${stackId}/issues`, {
        page: issuePage,
        pageSize: ISSUES_PER_PAGE,
      }),
  });

  const samples = useQuery({
    queryKey: qk.stackSamples(stackId, SAMPLE_HOURS),
    queryFn: () =>
      http.get<StackSample[]>(`/api/v1/stacks/${stackId}/samples`, { hours: SAMPLE_HOURS }),
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: qk.stack(stackId) });
    await queryClient.invalidateQueries({ queryKey: ['stackIssues', stackId] });
  };

  const ping = useMutation({
    mutationFn: () => http.post(`/api/v1/stacks/${stackId}/ping`),
    onSuccess: () => {
      toast({
        tone: 'success',
        title: 'Asked it to report in',
        description: 'This screen updates itself when it answers.',
        key: 'ping',
      });
    },
    onError: (error: Error) => {
      toast({ tone: 'danger', title: 'Could not reach it', description: error.message });
    },
  });

  const redeliver = useMutation({
    mutationFn: () =>
      http.post<{ issueId: string; delivered: boolean }>(`/api/v1/stacks/${stackId}/redeliver`),
    onSuccess: async (data) => {
      await refresh();
      toast({
        tone: 'success',
        title: data.delivered ? 'Sent again' : 'Queued',
        description: data.delivered
          ? 'It has the same document it was given before.'
          : 'It is offline, so it collects this the moment it reconnects.',
      });
    },
    onError: (error: Error) => {
      toast({ tone: 'danger', title: 'Could not send that again', description: error.message });
    },
  });

  const rotate = useMutation({
    mutationFn: () => http.post<{ envLines: string[] }>(`/api/v1/stacks/${stackId}/rotate`),
    onSuccess: async (data) => {
      await refresh();
      toast({
        tone: 'warning',
        title: 'Secret rotated',
        description: `Paste the new lines onto that server: ${data.envLines.length} of them.`,
        duration: 0,
      });
    },
    onError: (error: Error) => {
      toast({ tone: 'danger', title: 'Could not rotate that secret', description: error.message });
    },
  });

  const revoke = useMutation({
    mutationFn: () => http.del(`/api/v1/stacks/${stackId}`),
    onSuccess: async () => {
      await refresh();
      toast({ tone: 'success', title: 'Refused for good' });
      void navigate({ to: '/stacks' });
    },
    onError: (error: Error) => {
      toast({ tone: 'danger', title: 'Could not revoke it', description: error.message });
    },
  });

  const row = stack.data;
  const usage = (row?.usage ?? null) as {
    seatsActive?: number;
    storageBytes?: number;
    attachmentsBytes?: number;
    recordingsBytes?: number;
    backupsBytes?: number;
  } | null;
  const health = row?.health ?? null;
  const revoked = row?.revokedAt !== null && row?.revokedAt !== undefined;

  return (
    <>
      <PageHeader
        back={
          <Link
            to="/stacks"
            className="inline-flex items-center gap-1 text-muted no-underline hover:underline"
          >
            <ArrowLeft size={13} aria-hidden />
            Stacks
          </Link>
        }
        title={row?.label ?? 'Stack'}
        description={
          row === undefined ? undefined : (
            <span className="flex flex-wrap items-center gap-3">
              <Link to="/customers/$customerId" params={{ customerId: row.customer.id }}>
                {row.customer.name}
              </Link>
              {revoked ? (
                <Badge tone="neutral">Revoked</Badge>
              ) : (
                <StatusDot connected={row.connected} />
              )}
            </span>
          )
        }
        actions={
          row === undefined || revoked ? undefined : (
            <>
              {mayOperate && (
                <>
                  <Button
                    icon={Radio}
                    disabled={!row.connected}
                    title={row.connected ? undefined : 'It is offline, so there is nothing to ask'}
                    loading={ping.isPending}
                    onClick={() => {
                      ping.mutate();
                    }}
                  >
                    Report in now
                  </Button>
                  <Button
                    icon={Send}
                    loading={redeliver.isPending}
                    onClick={() => {
                      redeliver.mutate();
                    }}
                  >
                    Send its document again
                  </Button>
                </>
              )}
              {mayManage && (
                <>
                  <Button
                    icon={RefreshCw}
                    onClick={() => {
                      setConfirming('rotate');
                    }}
                  >
                    Rotate secret
                  </Button>
                  <Button
                    variant="danger"
                    icon={ShieldOff}
                    onClick={() => {
                      setConfirming('revoke');
                    }}
                  >
                    Revoke
                  </Button>
                </>
              )}
            </>
          )
        }
      />

      <StateSlot
        isPending={stack.isPending}
        error={stack.error}
        onRetry={() => {
          void stack.refetch();
        }}
      >
        {row !== undefined && (
          <div className="flex flex-col gap-5">
            <Section title="This server">
              <Fields columns={3}>
                <Field label="Last seen">{ago(row.lastSeenAt)}</Field>
                <Field label="Up since">{ago(row.startedAt)}</Field>
                <Field label="Version">
                  <code className="mono text-xs">{row.version ?? 'never reported'}</code>
                </Field>
                <Field label="Last backup">{ago(row.lastBackupAt)}</Field>
                <Field label="Seats in use">{usage?.seatsActive ?? '—'}</Field>
                <Field label="Storage">{bytes(usage?.storageBytes ?? null)}</Field>
              </Fields>
              <div className="mt-4">
                <CopyLine value={row.id} what="stack id" />
              </div>
              {mayManage && <Identity stack={row} />}
            </Section>

            <Section
              title="What it says about itself"
              description="The checks that stack runs on its own dependencies, as of its last heartbeat."
            >
              {health === null ? (
                <p className="text-base text-muted">
                  It has never reported its health, which means it has never connected.
                </p>
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {Object.entries(health.checks).map(([name, check]) => (
                    <li key={name} className="flex items-start gap-3 py-2.5">
                      {check.ok ? (
                        <Check size={14} className="text-success" aria-hidden />
                      ) : (
                        <X size={14} className="text-danger" aria-hidden />
                      )}
                      <span className="font-medium">{name}</span>
                      {check.error !== undefined && (
                        <span className="text-base text-danger">{check.error}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <DiagnosticsSection customerId={row.customer.id} connected={row.connected} />

            <Section
              title="The last day"
              description={`One point every five minutes, from its own heartbeats. Kept for thirty days.`}
            >
              <StateSlot
                isPending={samples.isPending}
                error={samples.error}
                isEmpty={samples.data?.length === 0}
                empty={
                  <EmptyState
                    title="Nothing recorded yet"
                    description="A stack has to report in before there is anything to plot."
                  />
                }
              >
                <Fields columns={3}>
                  <Field label="Heartbeats kept">{samples.data?.length ?? 0}</Field>
                  <Field label="Most seats seen">
                    {Math.max(0, ...(samples.data ?? []).map((s) => s.seatsActive))}
                  </Field>
                  <Field label="Failed checks">
                    {(samples.data ?? []).filter((s) => !s.readyOk).length}
                  </Field>
                </Fields>
              </StateSlot>
            </Section>

            <Section
              title="Documents"
              description="Everything this stack has been sent, newest first."
            >
              <StateSlot
                isPending={issues.isPending}
                error={issues.error}
                isEmpty={issues.data?.data.length === 0}
                empty={
                  <EmptyState
                    title="Nothing has been issued to it"
                    description="Issue one from the customer's entitlements tab."
                  />
                }
              >
                <div className="rounded-md border border-border bg-surface">
                  <Table
                    caption="Documents sent to this stack"
                    columns={[
                      {
                        key: 'issued',
                        header: 'Issued',
                        cell: (issue: Issue) => dateTime(issue.issuedAt),
                      },
                      {
                        key: 'status',
                        header: 'Status',
                        cell: (issue: Issue) => <IssueStatusBadge status={issue.status} />,
                      },
                      {
                        key: 'applied',
                        header: 'Applied',
                        cell: (issue: Issue) =>
                          issue.ackedAt === null ? (
                            <span className="text-muted">—</span>
                          ) : (
                            dateTime(issue.ackedAt)
                          ),
                      },
                      {
                        key: 'reason',
                        header: 'Reason',
                        cell: (issue: Issue) =>
                          issue.rejectReason === null ? (
                            <span className="text-muted">—</span>
                          ) : (
                            <span className="text-danger">{issue.rejectReason}</span>
                          ),
                      },
                    ]}
                    rows={issues.data?.data ?? []}
                    rowKey={(issue) => issue.id}
                  />
                </div>
                <div className="mt-3">
                  <Pager
                    page={issuePage}
                    pageSize={ISSUES_PER_PAGE}
                    total={issues.data?.page.total ?? 0}
                    onChange={setIssuePage}
                    noun="documents"
                  />
                </div>
              </StateSlot>
            </Section>
          </div>
        )}
      </StateSlot>

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(v) => {
          if (!v) setConfirming(null);
        }}
        title={
          confirming === 'rotate' ? 'Roll this stack’s secret?' : 'Refuse this stack for good?'
        }
        description={
          confirming === 'rotate'
            ? 'It disconnects immediately and stays disconnected until the new secret is in its environment file, which is a change somebody has to make on that server.'
            : 'Its credentials stop working and it can never reconnect. The customer’s data is untouched and their CRM keeps running on whatever document it last applied.'
        }
        consequences={
          confirming === 'rotate'
            ? [
                'The new secret is shown once and never again',
                'That server keeps running; it simply stops talking to us until it is updated',
              ]
            : [
                'Any document still waiting for it is closed',
                'A new stack, with new credentials, is what brings that customer back',
              ]
        }
        confirmLabel={confirming === 'rotate' ? 'Rotate' : 'Revoke'}
        tone="danger"
        typedConfirmation={confirming === 'revoke' ? (row?.label ?? undefined) : undefined}
        loading={rotate.isPending || revoke.isPending}
        onConfirm={() => {
          if (confirming === 'rotate') rotate.mutate();
          if (confirming === 'revoke') revoke.mutate();
          setConfirming(null);
        }}
      />
    </>
  );
}

/**
 * Asking the stack how it is, right now (docs/21 §9).
 *
 * Not a query with a stale time, because there is no such thing as a cached answer to this: the
 * heartbeat already says what was true up to thirty seconds ago, and the reason to ask is to know
 * what is true at the moment somebody is looking at it. So it is a button, and nothing is shown
 * until it has been pressed.
 *
 * Nothing here changes anything on that server, which is why the section is offered to anybody who
 * may read a stack at all.
 */
function DiagnosticsSection({ customerId, connected }: { customerId: string; connected: boolean }) {
  const ask = useMutation({
    mutationFn: () => http.post<StackDiagnostics>(`/api/v1/customers/${customerId}/diagnostics`),
    onError: (error: Error) => {
      toast({ tone: 'danger', title: 'It could not answer', description: error.message });
    },
  });

  const facts = ask.data?.facts ?? null;

  return (
    <Section
      title="Ask it how it is"
      description="Read from the stack when you press this, not from its last heartbeat. It changes nothing over there."
      actions={
        <Button
          icon={Stethoscope}
          disabled={!connected}
          title={connected ? undefined : 'It is offline, so there is nothing to ask'}
          loading={ask.isPending}
          onClick={() => {
            ask.mutate();
          }}
        >
          {ask.data === undefined ? 'Ask' : 'Ask again'}
        </Button>
      }
    >
      {facts === null ? (
        <p className="text-base text-muted">
          {connected
            ? 'Nothing has been asked yet. The answer is its version, schema state, queue backlogs, which integrations are on, and what each of its own checks says.'
            : 'It is offline. A stack that is not connected cannot be asked anything.'}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <Fields columns={3}>
            <Field label="Version">
              <code className="mono text-xs">{facts.version}</code>
            </Field>
            <Field label="Up for">{hours(facts.uptimeSeconds)}</Field>
            <Field label="Read">{dateTime(ask.data?.readAt)}</Field>
            <Field label="Schema">
              {facts.migrations.pending === 0 && facts.migrations.failed === 0 ? (
                <span>{count(facts.migrations.applied, 'migration')}, all applied</span>
              ) : (
                <Badge tone="danger">
                  {facts.migrations.failed > 0
                    ? `${count(facts.migrations.failed, 'migration')} rolled back`
                    : `${count(facts.migrations.pending, 'migration')} half applied`}
                </Badge>
              )}
            </Field>
            <Field label="Newest migration">
              <code className="mono text-xs break-all">{facts.migrations.latest ?? '—'}</code>
            </Field>
            <Field label="Seats in use">{facts.counts.seats}</Field>
            <Field label="Telephony">
              {facts.integrations.telephony.enabled ? (
                <Badge tone={facts.integrations.telephony.connected ? 'success' : 'warning'} dot>
                  {facts.integrations.telephony.connected ? 'Connected' : 'On, not connected'}
                </Badge>
              ) : (
                <span className="text-muted">Off</span>
              )}
            </Field>
            <Field label="WhatsApp">
              {facts.integrations.whatsapp.enabled ? (
                <Badge tone="success" dot>
                  {count(facts.integrations.whatsapp.channels, 'channel')}
                </Badge>
              ) : (
                <span className="text-muted">Off</span>
              )}
            </Field>
            <Field label="Recording kept for">
              {facts.recordingRetentionDays.effective === null
                ? 'No limit'
                : count(facts.recordingRetentionDays.effective, 'day')}
            </Field>
          </Fields>

          {/* Only the queues with something in them: nine rows of zeroes is a worse answer than
              one sentence saying everything is keeping up. */}
          <div>
            <p className="mb-2 text-sm font-medium text-muted">Background work</p>
            {facts.queues.every((q) => q.waiting + q.active + q.delayed + q.failed === 0) ? (
              <p className="text-base text-muted">
                Every queue is empty. Nothing is waiting and nothing has failed.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {facts.queues
                  .filter((q) => q.waiting + q.active + q.delayed + q.failed > 0)
                  .map((q) => (
                    <li
                      key={q.queue}
                      className="flex flex-wrap items-center gap-x-4 py-2 text-base"
                    >
                      <code className="mono w-44 shrink-0 text-xs">{q.queue}</code>
                      <span className="tnum text-muted">{q.waiting} waiting</span>
                      <span className="tnum text-muted">{q.active} running</span>
                      {q.delayed > 0 && (
                        <span className="tnum text-muted">{q.delayed} delayed</span>
                      )}
                      {q.failed > 0 && <span className="tnum text-danger">{q.failed} failed</span>}
                    </li>
                  ))}
              </ul>
            )}
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-muted">Its own checks, in full</p>
            <ul className="flex flex-col divide-y divide-border">
              {Object.entries(facts.checks).map(([name, check]) => (
                <li key={name} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2.5">
                  <span className="flex w-40 shrink-0 items-center gap-2">
                    {check.ok ? (
                      <Check size={14} className="text-success" aria-hidden />
                    ) : (
                      <X size={14} className="text-danger" aria-hidden />
                    )}
                    <span className="font-medium">{name}</span>
                  </span>
                  <span className="min-w-0 flex-1 text-base text-muted">
                    {check.error !== undefined ? (
                      <span className="text-danger">{check.error}</span>
                    ) : (
                      detailOf(check.detail)
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Section>
  );
}

/** A check's detail as a sentence. The shapes differ per check, so this stays deliberately plain. */
function detailOf(detail: Record<string, unknown> | undefined): string {
  if (detail === undefined) return 'Nothing to report';
  const parts = Object.entries(detail).map(([key, value]) => `${key}: ${showValue(value)}`);
  return parts.length === 0 ? 'Nothing to report' : parts.join(', ');
}

/**
 * One value from a check's detail, as text. Only the primitives get their own spelling; anything
 * else is JSON, because a stack is free to put a shape in there and "[object Object]" tells nobody
 * anything.
 */
function showValue(value: unknown): string {
  if (value === null) return 'none';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/** Uptime in the unit a person would say it in. */
function hours(seconds: number): string {
  if (seconds < 3600) return count(Math.round(seconds / 60), 'minute');
  const h = Math.round(seconds / 3600);
  return h < 48 ? count(h, 'hour') : count(Math.round(h / 24), 'day');
}

/** The label and the note, which are the only things about a stack a person writes. */
function Identity({ stack }: { stack: StackRow }) {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState(stack.label);
  const [notes, setNotes] = useState(stack.notes);
  const dirty = label.trim() !== stack.label || notes.trim() !== stack.notes;

  const save = useMutation({
    mutationFn: () =>
      http.patch<StackRow>(`/api/v1/stacks/${stack.id}`, {
        label: label.trim(),
        notes: notes.trim(),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.stack(stack.id) });
      toast({ tone: 'success', title: 'Saved' });
    },
    onError: (error: Error) => {
      toast({ tone: 'danger', title: 'Could not save that', description: error.message });
    },
  });

  return (
    <div className="mt-4 flex flex-col gap-3">
      <Input
        label="Label"
        description="What this machine is called between us."
        value={label}
        onChange={(e) => {
          setLabel(e.target.value);
        }}
      />
      <Textarea
        label="Notes"
        rows={2}
        maxLength={2000}
        description="Anything worth remembering about this particular server."
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
        }}
      />
      <div className="flex justify-end">
        <Button
          loading={save.isPending}
          disabled={!dirty || label.trim() === ''}
          onClick={() => {
            save.mutate();
          }}
        >
          Save
        </Button>
      </div>
    </div>
  );
}
