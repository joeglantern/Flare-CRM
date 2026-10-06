/**
 * Settings, Your plan: who people here should contact for help.
 *
 * An admin enters their own name, email and phone, and every "contact … to get access" message in
 * the CRM names them instead of the plan's contact, who is the provider and rarely the right first
 * call for an agent. Clearing it goes back to the plan's contact. Everyone else sees it read only.
 */
import { ownerContact, type OwnerContact } from '@crm/shared';
import { Pencil } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { toast } from '@/components/ui/toast';
import { Panel } from '@/components/entity/EntityHeader';
import { errorMessage } from '@/lib/api/errors';
import { useEntitlements } from '@/providers/entitlements';
import { usePermissions } from '@/providers/permissions';
import { useSettings } from '@/providers/settings';
import { useUpdateSettings } from './api';

const EMPTY = { name: '', email: '', phone: '' };

function ContactLines({ contact }: { contact: OwnerContact }) {
  return (
    <div className="text-base">
      <div>{contact.name}</div>
      <a href={`mailto:${contact.email}`}>{contact.email}</a>
      {contact.phone !== undefined && (
        <>
          {' · '}
          <a href={`tel:${contact.phone}`}>{contact.phone}</a>
        </>
      )}
    </div>
  );
}

export function SupportContactCard({ children }: { children?: React.ReactNode }) {
  const { ownerContact: planContact } = useEntitlements();
  const { supportContact } = useSettings();
  const canEdit = usePermissions().has('settings:manage');
  const update = useUpdateSettings();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const shown = supportContact ?? planContact;

  const save = (value: OwnerContact | null) => {
    update.mutate(
      { supportContact: value },
      {
        onSuccess: () => {
          setEditing(false);
          setErrors({});
          toast({
            tone: 'success',
            title: value === null ? 'Back to the plan contact' : 'Support contact saved',
          });
        },
        onError: (e) => {
          toast({ tone: 'danger', title: 'Could not save', description: errorMessage(e) });
        },
      },
    );
  };

  const submit = () => {
    const parsed = ownerContact.safeParse({
      name: form.name,
      email: form.email.trim(),
      ...(form.phone.trim() !== '' ? { phone: form.phone } : {}),
    });
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.error.issues.map((i) => [
            i.path.join('.'),
            i.path[0] === 'email' ? 'Enter a valid email address' : 'Required',
          ]),
        ),
      );
      return;
    }
    save(parsed.data);
  };

  return (
    <Panel
      title="Who to contact"
      note={supportContact === null ? 'from your plan' : 'set by your admin'}
      actions={
        canEdit && !editing ? (
          <Button
            variant="ghost"
            size="sm"
            icon={Pencil}
            onClick={() => {
              setForm({
                name: supportContact?.name ?? '',
                email: supportContact?.email ?? '',
                phone: supportContact?.phone ?? '',
              });
              setErrors({});
              setEditing(true);
            }}
          >
            Edit
          </Button>
        ) : undefined
      }
    >
      {editing ? (
        <form
          className="flex flex-col gap-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <p className="text-sm text-muted">
            Shown to everyone here whenever they need help or access, in place of your plan&apos;s
            contact.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Name"
              placeholder="IT support"
              value={form.name}
              error={errors.name}
              onChange={(e) => {
                setForm((f) => ({ ...f, name: e.target.value }));
              }}
            />
            <Input
              label="Email"
              type="email"
              value={form.email}
              error={errors.email}
              onChange={(e) => {
                setForm((f) => ({ ...f, email: e.target.value }));
              }}
            />
          </div>
          <Input
            label="Phone"
            description="Optional."
            value={form.phone}
            error={errors.phone}
            onChange={(e) => {
              setForm((f) => ({ ...f, phone: e.target.value }));
            }}
          />
          <div className="flex flex-wrap justify-end gap-2">
            {supportContact !== null && (
              <Button
                variant="ghost"
                disabled={update.isPending}
                onClick={() => {
                  save(null);
                }}
              >
                Use the plan contact
              </Button>
            )}
            <Button
              variant="ghost"
              disabled={update.isPending}
              onClick={() => {
                setEditing(false);
              }}
            >
              Cancel
            </Button>
            <Button variant="primary" type="submit" loading={update.isPending}>
              Save
            </Button>
          </div>
        </form>
      ) : (
        <>
          <ContactLines contact={shown} />
          {supportContact !== null && (
            <p className="mt-2 text-sm text-faint">
              Your plan comes from {planContact.name} ({planContact.email}).
            </p>
          )}
        </>
      )}
      {children}
    </Panel>
  );
}
