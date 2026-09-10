/**
 * Console settings: the signing key customers trust, the domain their subdomains hang off, and who
 * they should contact. The contact travels inside every signed document, so a customer whose feature
 * is switched off is told who to call rather than being left guessing.
 *
 * The signing key is shown, never edited. It comes from the environment, and changing it means
 * re-issuing to every customer.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Input, toast } from '@crm/ui';
import { CopyLine, Field, Fields } from '@/components/Bits';
import { PageHeader, Section, StateSlot } from '@/components/Page';
import { http } from '@/lib/api';
import { qk } from '@/lib/query';
import { useSocketStatus } from '@/lib/socket';
import type { ConsoleSettings } from '@/lib/types';

export function SettingsScreen() {
  const queryClient = useQueryClient();
  const connected = useSocketStatus((s) => s.connected);
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
                  value={contactName}
                  onChange={(e) => {
                    setContactName(e.target.value);
                  }}
                />
                <Input
                  label="Email"
                  type="email"
                  value={contactEmail}
                  onChange={(e) => {
                    setContactEmail(e.target.value);
                  }}
                />
                <Input
                  label="Phone"
                  description="Optional."
                  value={contactPhone}
                  onChange={(e) => {
                    setContactPhone(e.target.value);
                  }}
                />
              </div>
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
                <Field label="Health">
                  <a href="/ready" target="_blank" rel="noreferrer">
                    Readiness report
                  </a>
                </Field>
              </Fields>
            </Section>
          </div>
        )}
      </StateSlot>
    </>
  );
}
