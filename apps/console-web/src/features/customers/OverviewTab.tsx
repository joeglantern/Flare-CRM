/**
 * Who the customer is, where they live, and the state of their stack.
 *
 * Two things here are deliberately not buttons. Caddy cannot be reconfigured from inside a running
 * stack (docs/08 §N), so adding a domain of their own ends in a command an operator runs over SSH;
 * the console gives the exact line rather than pretending it can do it. And the provisioning
 * checklist reflects real state only: a tick means the console has seen it happen.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Circle, RefreshCw, Server, ShieldOff, X } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, ConfirmDialog, Input, toast } from '@crm/ui';
import { CopyLine, Field, Fields, StatusDot } from '@/components/Bits';
import { Section } from '@/components/Page';
import { http } from '@/lib/api';
import { ago, bytes, dateTime } from '@/lib/format';
import { qk } from '@/lib/query';
import type {
  ConsoleSettings,
  CustomerDetail,
  DomainCheck,
  DomainRecords,
  NewStackCredentials,
} from '@/lib/types';

export function OverviewTab({ detail }: { detail: CustomerDetail }) {
  const { customer, stacks } = detail;
  const queryClient = useQueryClient();
  const [credentials, setCredentials] = useState<NewStackCredentials | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

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
      <Section title="Contact">
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
          <Field label="Status">{customer.status}</Field>
        </Fields>
        {customer.notes !== '' && (
          <p className="mt-4 rounded-sm border border-border bg-bg p-3 text-base whitespace-pre-wrap">
            {customer.notes}
          </p>
        )}
      </Section>

      <DomainSection customer={customer} />

      <Section
        title="Stacks"
        description="One per server running this customer's CRM."
        actions={
          <Button
            icon={Server}
            loading={createStack.isPending}
            onClick={() => {
              createStack.mutate();
            }}
          >
            Create stack
          </Button>
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
