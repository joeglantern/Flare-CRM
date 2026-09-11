/**
 * Who the customer is, where they live, and the state of their stack.
 *
 * Two things here are deliberately not buttons. Caddy cannot be reconfigured from inside a running
 * stack (docs/08 §N), so adding a domain of their own ends in a command an operator runs over SSH;
 * the console gives the exact line rather than pretending it can do it. And the provisioning
 * checklist reflects real state only: a tick means the console has seen it happen.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Circle, Pencil, Radio, RefreshCw, Server, ShieldOff, X } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, ConfirmDialog, Dialog, Input, Segmented, Textarea, toast } from '@crm/ui';
import { CopyLine, Field, Fields, StatusDot } from '@/components/Bits';
import { Section } from '@/components/Page';
import { http } from '@/lib/api';
import { ago, bytes, dateTime } from '@/lib/format';
import { usePermissions } from '@/lib/permissions';
import { qk } from '@/lib/query';
import type {
  ConsoleSettings,
  Customer,
  CustomerDetail,
  DomainCheck,
  DomainRecords,
  NewStackCredentials,
  Stack,
} from '@/lib/types';
import {
  CUSTOMER_STATUSES,
  draftFrom,
  editPayload,
  hasChanges,
  STATUSES,
  type CustomerDraft,
  type CustomerStatus,
} from './customer-edit';

export function OverviewTab({ detail }: { detail: CustomerDetail }) {
  const { customer, stacks } = detail;
  const queryClient = useQueryClient();
  const [credentials, setCredentials] = useState<NewStackCredentials | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  // Support may ask a stack to report in, because that changes nothing. Holding its credentials,
  // and deciding who this customer is, are an owner's.
  const { can } = usePermissions();
  const mayEdit = can('customer:write');
  const mayManageStacks = can('stack:manage');
  const mayOperate = can('stack:operate');

  const settings = useQuery({
    queryKey: qk.settings(),
    queryFn: () => http.get<ConsoleSettings>('/api/v1/console/settings'),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: qk.customer(customer.id) });

  const createStack = useMutation({
    mutationFn: () => http.post<NewStackCredentials>(`/api/v1/customers/${customer.id}/stacks`, {}),
    onSuccess: async (data) => {
      setCredentials(data);
      await invalidate();
    },
    onError: (error: Error) => {
      toast({ tone: 'danger', title: 'Could not create a stack', description: error.message });
    },
  });

  const rotate = useMutation({
    mutationFn: (stackId: string) =>
      http.post<NewStackCredentials>(`/api/v1/stacks/${stackId}/rotate`),
    onSuccess: async (data) => {
      setCredentials(data);
      await invalidate();
      toast({
        tone: 'warning',
        title: 'Secret rotated',
        description: 'That stack is disconnected until the new secret is in its environment file.',
      });
    },
    onError: (error: Error) => {
      toast({ tone: 'danger', title: 'Could not rotate that secret', description: error.message });
    },
  });

  /**
   * A stack heartbeats every thirty seconds, which is a long time to stand over a server you have
   * just restarted. The answer comes back as a `fleet:stack` event, so nothing is refetched here.
   */
  const ping = useMutation({
    mutationFn: (stackId: string) => http.post(`/api/v1/stacks/${stackId}/ping`),
    onSuccess: () => {
      toast({
        tone: 'success',
        title: 'Asked it to report in',
        description: 'This screen updates itself when it answers.',
        key: 'ping',
      });
    },
    onError: (error: Error) => {
      toast({ tone: 'danger', title: 'Could not reach that stack', description: error.message });
    },
  });

  const revoke = useMutation({
    mutationFn: (stackId: string) => http.del(`/api/v1/stacks/${stackId}`),
    onSuccess: async () => {
      await invalidate();
      toast({ tone: 'success', title: 'Stack revoked' });
    },
    onError: (error: Error) => {
      toast({ tone: 'danger', title: 'Could not revoke that stack', description: error.message });
    },
  });

  const live = stacks.filter((s) => s.revokedAt === null);
  const provisionCommand = [
    'sudo ./provision-customer.sh',
    `--slug ${customer.slug}`,
    `--domain ${customer.primaryDomain}`,
    ...(customer.customDomain === null ? [] : [`--extra-domains ${customer.customDomain}`]),
    `--console-url ${settings.data?.consoleUrl ?? 'https://console.example.com'}`,
    '--stack-id <from the credentials above>',
    '--stack-secret <from the credentials above>',
    `--admin-email ${customer.contactEmail}`,
  ].join(' ');

  return (
    <div className="flex flex-col gap-5">
      <Section
        title="Contact"
        actions={
          mayEdit ? (
            <Button
              icon={Pencil}
              onClick={() => {
                setEditing(true);
              }}
            >
              Edit
            </Button>
          ) : undefined
        }
      >
        <Fields columns={3}>
          <Field label="Business">{customer.name}</Field>
          <Field label="Person">{customer.contactName}</Field>
          <Field label="Email">
            <a href={`mailto:${customer.contactEmail}`}>{customer.contactEmail}</a>
          </Field>
          <Field label="Phone">
            {customer.contactPhone === null ? (
              <span className="text-muted">Not given</span>
            ) : (
              <a href={`tel:${customer.contactPhone}`}>{customer.contactPhone}</a>
            )}
          </Field>
          <Field label="Added">{dateTime(customer.createdAt)}</Field>
        </Fields>
        {customer.notes !== '' && (
          <p className="mt-4 rounded-sm border border-border bg-bg p-3 text-base whitespace-pre-wrap">
            {customer.notes}
          </p>
        )}
      </Section>

      <StatusSection customer={customer} stacks={stacks} />

      <DomainSection customer={customer} />

      <Section
        title="Stacks"
        description="One per server running this customer's CRM."
        actions={
          mayManageStacks ? (
            <Button
              icon={Server}
              loading={createStack.isPending}
              onClick={() => {
                createStack.mutate();
              }}
            >
              Create stack
            </Button>
          ) : undefined
        }
      >
        {live.length === 0 ? (
          <p className="text-base text-muted">
            No stack yet. Create one to get the four environment lines that customer&rsquo;s server
            needs.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {live.map((stack) => (
              <li key={stack.id} className="rounded-sm border border-border bg-bg p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-3">
                    <code className="mono text-xs">{stack.id}</code>
                    <StatusDot connected={stack.connected} />
                    {stack.version !== null && <Badge tone="neutral">{stack.version}</Badge>}
                  </span>
                  <span className="flex items-center gap-2">
                    {mayOperate && (
                      <Button
                        size="sm"
                        icon={Radio}
                        disabled={!stack.connected}
                        title={
                          stack.connected ? undefined : 'It is offline, so there is nothing to ask'
                        }
                        loading={ping.isPending && ping.variables === stack.id}
                        onClick={() => {
                          ping.mutate(stack.id);
                        }}
                      >
                        Refresh now
                      </Button>
                    )}
                    {mayManageStacks && (
                      <>
                        <Button
                          size="sm"
                          icon={RefreshCw}
                          loading={rotate.isPending && rotate.variables === stack.id}
                          onClick={() => {
                            rotate.mutate(stack.id);
                          }}
                        >
                          Rotate secret
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          icon={ShieldOff}
                          onClick={() => {
                            setRevoking(stack.id);
                          }}
                        >
                          Revoke
                        </Button>
                      </>
                    )}
                  </span>
                </div>
                <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-4">
                  <Field label="Last seen">{ago(stack.lastSeenAt)}</Field>
                  <Field label="Last backup">{ago(stack.lastBackupAt)}</Field>
                  <Field label="Storage">{bytes(stack.usage?.storageBytes ?? null)}</Field>
                  <Field label="Seats in use">{stack.usage?.seatsActive ?? '—'}</Field>
                </dl>
                {stack.health !== null && !stack.health.ok && (
                  <p className="mt-2 text-base text-danger">
                    That stack last reported itself unhealthy:{' '}
                    {Object.entries(stack.health.checks)
                      .filter(([, v]) => !v.ok)
                      .map(([k]) => k)
                      .join(', ')}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Provisioning"
        description="What has to be true before that customer can sign in."
      >
        <ul className="flex flex-col gap-2">
          <Checklist done={live.length > 0} label="A stack has credentials" />
          <Checklist
            done={live.some((s) => s.lastSeenAt !== null)}
            label="That stack has reported in at least once"
          />
          <Checklist done={live.some((s) => s.connected)} label="It is connected right now" />
          <Checklist
            done={live.some((s) => s.currentIssueId !== null)}
            label="It has applied an entitlements document"
          />
          <Checklist
            done={live.some((s) => s.lastBackupAt !== null)}
            label="A backup has run on it"
          />
        </ul>
        <p className="mt-4 text-base text-muted">
          The server itself is set up over SSH, because a container cannot rewrite the web server in
          front of it. Run this on the customer&rsquo;s machine:
        </p>
        <div className="mt-2">
          <CopyLine value={provisionCommand} what="command" />
        </div>
      </Section>

      <EditCustomerDialog customer={customer} open={editing} onOpenChange={setEditing} />

      <StackCredentials
        credentials={credentials}
        onClose={() => {
          setCredentials(null);
        }}
      />

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(v) => {
          if (!v) setRevoking(null);
        }}
        title="Revoke this stack?"
        description="Its credentials stop working immediately and it disconnects. The customer's data is untouched; the stack keeps running on whatever document it last applied."
        consequences={[
          'The stack can no longer receive plan changes or announcements',
          'A new stack, with new credentials, is needed to reconnect it',
        ]}
        confirmLabel="Revoke"
        loading={revoke.isPending}
        onConfirm={() => {
          if (revoking !== null) revoke.mutate(revoking);
          setRevoking(null);
        }}
      />
    </div>
  );
}

function Checklist({ done, label }: { done: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 text-base">
      {done ? (
        <Check size={14} className="text-success" aria-hidden />
      ) : (
        <Circle size={14} className="text-faint" aria-hidden />
      )}
      <span className={done ? '' : 'text-muted'}>{label}</span>
      <span className="sr-only">{done ? 'done' : 'not done yet'}</span>
    </li>
  );
}

function DomainSection({ customer }: { customer: CustomerDetail['customer'] }) {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const mayEdit = can('customer:write');
  const [domain, setDomain] = useState(customer.customDomain ?? '');
  const [records, setRecords] = useState<DomainRecords | null>(null);
  const [check, setCheck] = useState<DomainCheck | null>(null);

  const save = useMutation({
    mutationFn: () =>
      http.put<DomainRecords>(`/api/v1/customers/${customer.id}/domain`, {
        customDomain: domain.trim() === '' ? null : domain.trim().toLowerCase(),
      }),
    onSuccess: async (data) => {
      setRecords(data);
      setCheck(null);
      await queryClient.invalidateQueries({ queryKey: qk.customer(customer.id) });
    },
    onError: (error: Error) => {
      toast({ tone: 'danger', title: 'Could not save that domain', description: error.message });
    },
  });

  const verify = useMutation({
    mutationFn: () => http.post<DomainCheck>(`/api/v1/customers/${customer.id}/domain/verify`),
    onSuccess: async (data) => {
      setCheck(data);
      await queryClient.invalidateQueries({ queryKey: qk.customer(customer.id) });
      if (data.verified) toast({ tone: 'success', title: 'Domain verified' });
    },
    onError: (error: Error) => {
      toast({ tone: 'danger', title: 'Could not check those records', description: error.message });
    },
  });

  const txtName = records?.txtName ?? null;
  const txtValue = records?.txtValue ?? null;

  return (
    <Section
      title="Domains"
      description="Every customer has a subdomain of ours. A domain of their own needs two DNS records and one command on their server."
    >
      <Fields>
        <Field label="Ours">
          <span className="mono text-sm">{customer.primaryDomain}</span>
        </Field>
        <Field label="Theirs">
          {customer.customDomain === null ? (
            <span className="text-muted">None</span>
          ) : (
            <span className="flex items-center gap-2">
              <span className="mono text-sm">{customer.customDomain}</span>
              {customer.customDomainVerifiedAt === null ? (
                <Badge tone="warning">Not verified</Badge>
              ) : (
                <Badge tone="success">Verified</Badge>
              )}
            </span>
          )}
        </Field>
      </Fields>

      {mayEdit && (
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <Input
            label="Their domain"
            placeholder="crm.theircompany.co.ke"
            mono
            containerClassName="w-72"
            value={domain}
            onChange={(e) => {
              setDomain(e.target.value);
            }}
          />
          <Button
            loading={save.isPending}
            onClick={() => {
              save.mutate();
            }}
          >
            Save
          </Button>
          <Button
            variant="primary"
            loading={verify.isPending}
            disabled={customer.customDomain === null}
            onClick={() => {
              verify.mutate();
            }}
          >
            Check DNS
          </Button>
        </div>
      )}

      {txtName !== null && txtValue !== null && (
        <div className="mt-4 flex flex-col gap-2">
          <p className="text-base text-muted">Ask them to publish these two records:</p>
          <CopyLine
            value={`CNAME  ${domain}  ->  ${records?.cnameTarget ?? customer.primaryDomain}`}
            what="CNAME record"
          />
          <CopyLine value={`TXT  ${txtName}  ->  ${txtValue}`} what="TXT record" />
        </div>
      )}

      {check !== null && (
        <ul className="mt-4 flex flex-col gap-1.5">
          <DnsResult
            ok={check.cname.ok}
            label={`CNAME points at ${customer.primaryDomain}`}
            detail={
              check.cname.found.length === 0
                ? 'nothing published yet'
                : check.cname.found.join(', ')
            }
          />
          <DnsResult ok={check.txt.ok} label="Verification TXT record matches" />
          <DnsResult
            ok={check.primaryResolves.ok}
            label="Our subdomain resolves"
            detail={check.primaryResolves.addresses.join(', ')}
          />
          {check.verified && (
            <li className="mt-2 text-base">
              Both records are in place. The last step is on their server: re-run the provisioning
              command with this domain in <code className="mono text-xs">--extra-domains</code> so
              the web server asks for a certificate for it.
            </li>
          )}
        </ul>
      )}
    </Section>
  );
}

function DnsResult({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <li className="flex items-center gap-2 text-base">
      {ok ? (
        <Check size={14} className="text-success" aria-hidden />
      ) : (
        <X size={14} className="text-danger" aria-hidden />
      )}
      <span>{label}</span>
      {detail !== undefined && detail !== '' && (
        <span className="mono text-xs text-muted">{detail}</span>
      )}
    </li>
  );
}

function StackCredentials({
  credentials,
  onClose,
}: {
  credentials: NewStackCredentials | null;
  onClose: () => void;
}) {
  if (credentials === null) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Stack credentials"
      className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[8vh]"
    >
      <div className="w-full max-w-lg rounded-md border border-border bg-raised p-4 shadow-float">
        <h2 className="text-lg font-semibold">Stack credentials</h2>
        <p className="mt-1 text-base text-muted">
          Shown once. The secret is stored only as a hash, so if it is lost the stack needs a new
          one.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          {credentials.envLines.map((line) => (
            <CopyLine key={line} value={line} what="line" />
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            onClick={() => {
              void navigator.clipboard.writeText(credentials.envLines.join('\n')).catch(() => {
                toast({ tone: 'danger', title: 'The browser would not let us copy that' });
              });
            }}
          >
            Copy all four
          </Button>
          <Button variant="primary" onClick={onClose}>
            I have saved them
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * The status control, kept apart from the read-only contact block because it is the one thing on
 * this screen that changes what a customer's own people can do.
 *
 * Changing it here records the decision. It reaches their stack when the entitlements are issued,
 * which is why suspending offers to issue straight away: a suspension nobody has been told about is
 * not a suspension.
 */
function StatusSection({ customer, stacks }: { customer: Customer; stacks: Stack[] }) {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const mayEdit = can('customer:write');
  const [choosing, setChoosing] = useState<CustomerStatus | null>(null);

  const current = (CUSTOMER_STATUSES as readonly string[]).includes(customer.status)
    ? (customer.status as CustomerStatus)
    : 'active';
  const live = stacks.filter((s) => s.revokedAt === null);
  const connected = live.some((s) => s.connected);

  const change = useMutation({
    mutationFn: (status: CustomerStatus) =>
      http.patch<Customer>(`/api/v1/customers/${customer.id}`, { status }),
    onSuccess: async (_data, status) => {
      await queryClient.invalidateQueries({ queryKey: qk.customer(customer.id) });
      await queryClient.invalidateQueries({ queryKey: qk.fleet() });
      toast({
        tone: 'success',
        title: `Marked ${STATUSES[status].label.toLowerCase()}`,
        description:
          live.length === 0
            ? 'There is no stack to tell yet. The first document this customer is issued will carry it.'
            : connected
              ? 'A new document has already been sent to their stack.'
              : 'Their stack is offline. It collects the new document the moment it reconnects.',
      });
    },
    onError: (error: Error) => {
      toast({ tone: 'danger', title: 'Could not change that status', description: error.message });
    },
  });

  return (
    <Section title="Status" description="What this customer's own people can do right now.">
      <div className="flex flex-col gap-3">
        {mayEdit ? (
          <Segmented<CustomerStatus>
            ariaLabel="Customer status"
            value={current}
            onChange={(next) => {
              if (next !== current) setChoosing(next);
            }}
            options={CUSTOMER_STATUSES.map((status) => ({
              value: status,
              label: STATUSES[status].label,
            }))}
          />
        ) : (
          <span>
            <Badge tone={current === 'active' ? 'success' : 'warning'}>
              {STATUSES[current].label}
            </Badge>
          </span>
        )}
        <p className="text-base text-muted">{STATUSES[current].short}</p>
        {customer.suspendedAt !== null && (
          <p className="text-base text-warning">
            Held read only since {dateTime(customer.suspendedAt)}.
          </p>
        )}
      </div>

      <ConfirmDialog
        open={choosing !== null}
        onOpenChange={(v) => {
          if (!v) setChoosing(null);
        }}
        title={
          choosing === null
            ? ''
            : `Mark ${customer.name} ${STATUSES[choosing].label.toLowerCase()}?`
        }
        description={choosing === null ? '' : STATUSES[choosing].short}
        // Changing the status is the whole act: the server reissues the document and sends it in the
        // same request, so there is nothing left for an owner to remember to do afterwards.
        consequences={
          choosing === null
            ? []
            : [
                ...STATUSES[choosing].consequences,
                live.length === 0
                  ? 'There is no stack yet, so this waits for the first document that customer is issued'
                  : connected
                    ? 'Their stack is sent a new document immediately and applies it at once'
                    : 'Their stack is offline, so it applies the new document when it next connects',
              ]
        }
        confirmLabel={choosing === null ? 'Confirm' : STATUSES[choosing].label}
        tone={choosing === 'active' ? 'primary' : 'danger'}
        loading={change.isPending}
        onConfirm={() => {
          if (choosing !== null) change.mutate(choosing);
          setChoosing(null);
        }}
      />
    </Section>
  );
}

/**
 * Mounted only while it is open, so the form always starts from what the server last said rather
 * than from whatever was typed and abandoned last time.
 */
function EditCustomerDialog({
  customer,
  open,
  onOpenChange,
}: {
  customer: Customer;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  if (!open) return null;
  return (
    <EditCustomerForm
      customer={customer}
      onClose={() => {
        onOpenChange(false);
      }}
    />
  );
}

function EditCustomerForm({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<CustomerDraft>(() => draftFrom(customer));
  const [error, setError] = useState<string | undefined>(undefined);

  const save = useMutation({
    mutationFn: () =>
      http.patch<Customer>(`/api/v1/customers/${customer.id}`, editPayload(customer, draft)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.customer(customer.id) });
      await queryClient.invalidateQueries({ queryKey: qk.fleet() });
      toast({ tone: 'success', title: 'Saved' });
      onClose();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const set = (patch: Partial<CustomerDraft>) => {
    setDraft({ ...draft, ...patch });
  };

  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      title={`Edit ${customer.name}`}
      description="Who we bill and who we call. The subdomain and the status are changed elsewhere, because both of those reach into a running CRM."
      width={560}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={
              !hasChanges(customer, draft) ||
              draft.name.trim() === '' ||
              draft.contactName.trim() === '' ||
              draft.contactEmail.trim() === ''
            }
            onClick={() => {
              setError(undefined);
              save.mutate();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          autoFocus
          label="Business"
          value={draft.name}
          onChange={(e) => {
            set({ name: e.target.value });
          }}
        />
        <Input
          label="Person"
          description="Whoever we speak to about this account."
          value={draft.contactName}
          onChange={(e) => {
            set({ contactName: e.target.value });
          }}
        />
        <Input
          label="Email"
          type="email"
          error={error}
          value={draft.contactEmail}
          onChange={(e) => {
            set({ contactEmail: e.target.value });
          }}
        />
        <Input
          label="Phone"
          description="Leave it empty if we do not have one."
          value={draft.contactPhone}
          onChange={(e) => {
            set({ contactPhone: e.target.value });
          }}
        />
        <Textarea
          label="Notes"
          rows={4}
          maxLength={4000}
          description="For us, not for them. Nobody at that business ever sees this."
          value={draft.notes}
          onChange={(e) => {
            set({ notes: e.target.value });
          }}
        />
      </div>
    </Dialog>
  );
}
