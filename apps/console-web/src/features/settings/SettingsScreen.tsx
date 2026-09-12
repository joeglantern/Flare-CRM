/**
 * Console settings: the signing key customers trust, the domain their subdomains hang off, and who
 * they should contact. The contact travels inside every signed document, so a customer whose feature
 * is switched off is told who to call rather than being left guessing.
 *
 * The signing key is shown, never edited. It comes from the environment, and changing it means
 * re-issuing to every customer.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, KeyRound, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { useState } from 'react';
import type { AlertRecipients, AlertThresholds } from '@crm/shared';
import { Badge, Banner, Button, Input, toast } from '@crm/ui';
import { CopyLine, Field, Fields } from '@/components/Bits';
import { PageHeader, Section, StateSlot } from '@/components/Page';
import { http } from '@/lib/api';
import { ago } from '@/lib/format';
import { usePermissions } from '@/lib/permissions';
import { qk } from '@/lib/query';
import { useSocketStatus } from '@/lib/socket';
import type { ConsoleSettings } from '@/lib/types';
import { humanise, readReadiness, showValue, type ReadinessCheck } from './readiness';

export function SettingsScreen() {
  const queryClient = useQueryClient();
  const connected = useSocketStatus((s) => s.connected);
  // The contact travels inside every signed document, so changing it changes what every customer is
  // told to do when something is switched off. That is an owner's call.
  const { can } = usePermissions();
  const mayManage = can('settings:manage');
  const settings = useQuery({
    queryKey: qk.settings(),
    queryFn: () => http.get<ConsoleSettings>('/api/v1/console/settings'),
  });

  // No draft until somebody types: the fields simply show what the server holds, so a value saved
  // elsewhere appears here without an effect copying it into state.
  const [draft, setDraft] = useState<{ name: string; email: string; phone: string } | null>(null);
  const stored = settings.data?.ownerContact;
  const form = draft ?? {
    name: stored?.name ?? '',
    email: stored?.email ?? '',
    phone: stored?.phone ?? '',
  };
  const contactName = form.name;
  const contactEmail = form.email;
  const contactPhone = form.phone;
  const setContactName = (name: string) => {
    setDraft({ ...form, name });
  };
  const setContactEmail = (email: string) => {
    setDraft({ ...form, email });
  };
  const setContactPhone = (phone: string) => {
    setDraft({ ...form, phone });
  };

  const save = useMutation({
    mutationFn: () =>
      http.put('/api/v1/console/settings', {
        ownerContact: {
          name: contactName.trim(),
          email: contactEmail.trim(),
          ...(contactPhone.trim() === '' ? {} : { phone: contactPhone.trim() }),
        },
      }),
    onSuccess: async () => {
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey: qk.settings() });
      toast({
        tone: 'success',
        title: 'Saved',
        description: 'Customers see the new contact on their next issued document.',
      });
    },
    onError: (error: Error) => {
      toast({ tone: 'danger', title: 'Could not save that', description: error.message });
    },
  });

  const contact = settings.data?.ownerContact;
  const dirty =
    contact !== undefined &&
    (contact.name !== contactName.trim() ||
      contact.email !== contactEmail.trim() ||
      (contact.phone ?? '') !== contactPhone.trim());

  return (
    <>
      <PageHeader title="Settings" description="How this console identifies itself to customers." />

      <StateSlot
        isPending={settings.isPending}
        error={settings.error}
        onRetry={() => {
          void settings.refetch();
        }}
      >
        {settings.data !== undefined && (
          <div className="flex flex-col gap-5">
            <Section
              title="Support contact"
              description="Sent inside every entitlements document. It is what a customer's locked screen tells them to do."
            >
              <div className="grid gap-4 sm:grid-cols-3">
                <Input
                  label="Name"
                  disabled={!mayManage}
                  value={contactName}
                  onChange={(e) => {
                    setContactName(e.target.value);
                  }}
                />
                <Input
                  label="Email"
                  type="email"
                  disabled={!mayManage}
                  value={contactEmail}
                  onChange={(e) => {
                    setContactEmail(e.target.value);
                  }}
                />
                <Input
                  label="Phone"
                  description="Optional."
                  disabled={!mayManage}
                  value={contactPhone}
                  onChange={(e) => {
                    setContactPhone(e.target.value);
                  }}
                />
              </div>
              {mayManage && (
                <div className="mt-4 flex justify-end">
                  <Button
                    variant="primary"
                    loading={save.isPending}
                    disabled={!dirty || contactName.trim() === '' || contactEmail.trim() === ''}
                    onClick={() => {
                      save.mutate();
                    }}
                  >
                    Save contact
                  </Button>
                </div>
              )}
            </Section>

            <Section
              title="Signing key"
              description="Every customer stack carries the public half and refuses any document not signed by this key."
            >
              <Fields>
                <Field label="Fingerprint">
                  <span className="flex items-center gap-2">
                    <Badge tone="flare" icon={KeyRound}>
                      {settings.data.signingKey.algorithm}
                    </Badge>
                    <code className="mono text-xs">{settings.data.signingKey.keyId}</code>
                  </span>
                </Field>
                <Field label="Brand domain">
                  <code className="mono text-xs">{settings.data.brandDomain}</code>
                </Field>
              </Fields>
              <p className="mt-4 text-base text-muted">
                This is the line a customer&rsquo;s server needs, and it is safe to send over any
                channel: it is the public half.
              </p>
              <div className="mt-2">
                <CopyLine
                  value={`CONSOLE_PUBLIC_KEY=${settings.data.signingKey.publicKeySpkiBase64}`}
                  what="public key"
                />
              </div>
              <p className="mt-3 text-base text-muted">
                Replacing the key means every customer has to be issued a new document before they
                trust anything from here again. The fleet screen shows who has not applied one.
              </p>
            </Section>

            <Section title="This console">
              <Fields columns={3}>
                <Field label="Address">
                  <code className="mono text-xs">{settings.data.consoleUrl}</code>
                </Field>
                <Field label="Live link">
                  {connected ? (
                    <Badge tone="success" dot>
                      Connected
                    </Badge>
                  ) : (
                    <Badge tone="warning" dot>
                      Not connected
                    </Badge>
                  )}
                </Field>
              </Fields>
            </Section>

            <AlertSettingsSection />

            <ReadinessSection signingKeyId={settings.data.signingKey.keyId} />
          </div>
        )}
      </StateSlot>
    </>
  );
}

/**
 * How long the console waits before calling something a problem, and who hears about it.
 *
 * These were constants in a source file, which meant every judgement about somebody else's business
 * was a deployment. They are judgements, not facts: a customer who backs up to their own tape and one
 * who relies on ours deserve different answers about a stale backup.
 *
 * Recipients are deliberately plain. Per-kind routing exists on the server, but the screen offers the
 * one list that matters, because an address per check is a way to end up with a check nobody reads.
 */
function AlertSettingsSection() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const mayManage = can('alert:manage');

  const config = useQuery({
    queryKey: qk.alertSettings(),
    queryFn: () =>
      http.get<{ thresholds: AlertThresholds; recipients: AlertRecipients }>(
        '/api/v1/alerts/settings',
      ),
  });

  const [draft, setDraft] = useState<Partial<Record<ThresholdKey, string>> | null>(null);
  const [emails, setEmails] = useState<string | null>(null);

  const stored = config.data;
  const valueOf = (key: ThresholdKey): string =>
    draft?.[key] ?? (stored === undefined ? '' : String(stored.thresholds[key]));
  const emailsValue = emails ?? stored?.recipients.default.join(', ') ?? '';

  const save = useMutation({
    mutationFn: () => {
      const thresholds: Record<string, number> = {};
      for (const field of THRESHOLD_FIELDS) {
        const parsed = Number(valueOf(field.key));
        if (Number.isFinite(parsed)) thresholds[field.key] = parsed;
      }
      const addresses = emailsValue
        .split(',')
        .map((e) => e.trim())
        .filter((e) => e !== '');
      return http.put('/api/v1/alerts/settings', {
        thresholds,
        recipients: { default: addresses, byKind: stored?.recipients.byKind ?? {} },
      });
    },
    onSuccess: async () => {
      setDraft(null);
      setEmails(null);
      await queryClient.invalidateQueries({ queryKey: qk.alertSettings() });
      toast({
        tone: 'success',
        title: 'Saved',
        description: 'The next sweep uses these. Alerts already open are left alone.',
      });
    },
    onError: (error: Error) => {
      toast({ tone: 'danger', title: 'Could not save that', description: error.message });
    },
  });

  return (
    <Section
      title="What counts as a problem"
      description="How long the console waits before opening an alert, and who is emailed when it does."
    >
      <StateSlot
        isPending={config.isPending}
        error={config.error}
        onRetry={() => {
          void config.refetch();
        }}
      >
        {stored !== undefined && (
          <div className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-3">
              {THRESHOLD_FIELDS.map((field) => (
                <Input
                  key={field.key}
                  label={field.label}
                  description={field.description}
                  disabled={!mayManage}
                  inputMode="numeric"
                  value={valueOf(field.key)}
                  onChange={(e) => {
                    setDraft({ ...draft, [field.key]: e.target.value });
                  }}
                />
              ))}
            </div>

            <Input
              label="Email alerts to"
              description="Comma separated. Empty falls back to the support contact above, which is always somebody real."
              disabled={!mayManage}
              value={emailsValue}
              onChange={(e) => {
                setEmails(e.target.value);
              }}
            />

            {mayManage && (
              <div className="flex justify-end">
                <Button
                  variant="primary"
                  loading={save.isPending}
                  disabled={draft === null && emails === null}
                  onClick={() => {
                    save.mutate();
                  }}
                >
                  Save thresholds
                </Button>
              </div>
            )}
          </div>
        )}
      </StateSlot>
    </Section>
  );
}

type ThresholdKey = keyof AlertThresholds;

/** Only the ones an operator has an opinion about. The rest keep their defaults. */
const THRESHOLD_FIELDS: { key: ThresholdKey; label: string; description: string }[] = [
  {
    key: 'offlineMinutes',
    label: 'Offline after',
    description: 'Minutes of silence from a stack that was talking.',
  },
  {
    key: 'neverConnectedHours',
    label: 'Never connected after',
    description: 'Hours from issuing credentials to calling it a fault.',
  },
  {
    key: 'backupStaleHours',
    label: 'Backup stale after',
    description: 'Hours since the last backup was reported.',
  },
  {
    key: 'undeliveredMinutes',
    label: 'Document unapplied after',
    description: 'Minutes a connected stack has to apply one.',
  },
  {
    key: 'expiryWarningDays',
    label: 'Warn before expiry',
    description: 'Days ahead of a plan running out.',
  },
  {
    key: 'trialEndingDays',
    label: 'Warn before a trial ends',
    description: 'Days ahead of a trial turning into an invoice.',
  },
];

/**
 * What `/ready` says, rendered.
 *
 * This used to be a link that opened a tab of raw JSON. The verdict is the part anyone actually
 * wants, and it was the part hardest to find in it.
 *
 * The four checks it has today are not hard coded. A check is a name, a state and an arbitrary
 * detail object, so a fifth one added on the server appears here with its own detail spelled out in
 * English and nothing to change in this file.
 */
function ReadinessSection({ signingKeyId }: { signingKeyId: string }) {
  const readiness = useQuery({
    queryKey: qk.readiness(),
    queryFn: readReadiness,
    // It is a probe, not a record: what it said a minute ago is not worth showing as if it were now.
    staleTime: 0,
    // readReadiness resolves for every outcome, including a dead socket, so there is nothing here
    // that a retry would rescue and no error branch for this query to take.
    retry: false,
  });

  const result = readiness.data;
  const verdict =
    result === undefined
      ? null
      : !result.reachable
        ? {
            tone: 'danger' as const,
            title: 'The console could not answer',
            detail:
              'Nothing came back from /ready. A console that cannot say whether it is ready is not ready.',
          }
        : result.ok
          ? {
              tone: 'info' as const,
              title: 'Ready',
              detail: 'Every check the console runs on itself passed.',
            }
          : {
              tone: 'danger' as const,
              title: 'Not ready',
              detail: 'At least one of the console’s own checks is failing.',
            };

  const checks = Object.entries(result?.checks ?? {});

  return (
    <Section
      title="Readiness"
      description="What this console says about itself, read live rather than from a cache."
      actions={
        <Button
          icon={RefreshCw}
          loading={readiness.isFetching}
          onClick={() => {
            void readiness.refetch();
          }}
        >
          Check again
        </Button>
      }
    >
      <StateSlot isPending={readiness.isPending} error={null}>
        {verdict !== null && result !== undefined && (
          <div className="flex flex-col gap-4">
            <Banner
              tone={verdict.tone}
              icon={verdict.tone === 'info' ? ShieldCheck : AlertTriangle}
              meta={`Read ${ago(result.readAt)}`}
            >
              <span className="font-medium">{verdict.title}</span>
              <span className="ml-2 text-muted">{verdict.detail}</span>
            </Banner>

            {result.checks === null ? (
              <p className="text-base text-muted">
                {result.reachable
                  ? 'The console gave its verdict without itemising it. It only lists the individual checks for a request coming from the machine it runs on, so opening this console over its own address will show the verdict alone.'
                  : 'There is nothing to itemise: the request did not reach the console.'}
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {checks.map(([name, check]) => (
                  <li key={name} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2.5">
                    <span className="flex w-32 shrink-0 items-center gap-2">
                      {check.ok ? (
                        <Check size={14} className="text-success" aria-hidden />
                      ) : (
                        <X size={14} className="text-danger" aria-hidden />
                      )}
                      <span className="font-medium">{humanise(name)}</span>
                      <span className="sr-only">{check.ok ? 'passing' : 'failing'}</span>
                    </span>
                    <span className="min-w-0 flex-1 text-base text-muted">
                      <CheckDetail name={name} check={check} signingKeyId={signingKeyId} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </StateSlot>
    </Section>
  );
}

/**
 * A check's own words. `error` wins over `detail`, because a check that threw has nothing useful in
 * its detail and the message is the whole point of looking.
 *
 * The signing key is the one special case, and it is a comparison rather than a value: the key id is
 * already printed further up this screen, so printing it again teaches nobody anything, while saying
 * whether the running signer is that same key is worth knowing.
 */
function CheckDetail({
  name,
  check,
  signingKeyId,
}: {
  name: string;
  check: ReadinessCheck;
  signingKeyId: string;
}) {
  if (check.error !== undefined) return <span className="text-danger">{check.error}</span>;

  const detail = check.detail;
  if (detail === undefined) return <span className="text-faint">Nothing to report</span>;

  const entries = Object.entries(detail).filter(
    ([key]) => !(name === 'signing' && key === 'keyId'),
  );
  const signingKey = name === 'signing' ? detail.keyId : undefined;

  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {typeof signingKey === 'string' &&
        (signingKey === signingKeyId ? (
          <span>Signing with the key shown above</span>
        ) : (
          <span className="text-danger">
            Signing with a different key from the one shown above. Documents issued now will not
            match what customers were told to trust.
          </span>
        ))}
      {entries.map(([key, value]) => (
        <span key={key}>
          {humanise(key)}: <span className="text-text">{showValue(value)}</span>
        </span>
      ))}
    </span>
  );
}
