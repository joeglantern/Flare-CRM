/**
 * Contact create and edit (Contacts · Create / Edit), in a right-hand drawer.
 * Validation comes from the shared Zod schema; a 422 lands inline on the exact field the server
 * named (`details[i].path`, e.g. `phones.0.number`) and the first error is focused.
 */
import { createContactBody, updateContactBody, type ContactDto } from '@crm/shared';
import { Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useResetWhen } from '@/lib/hooks';
import { Button, IconButton } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Drawer } from '@/components/ui/Overlay';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Toggle';
import { toast } from '@/components/ui/toast';
import { CustomFieldsForm } from '@/components/entity/CustomFields';
import { CompanyPicker, OwnerPicker } from '@/components/entity/pickers';
import { TagInput } from '@/components/entity/TagInput';
import { useCustomFields } from '@/features/settings/api';
import { errorMessage, isApiError } from '@/lib/api/errors';
import { useMe } from '@/lib/auth/me';
import { usePermissions } from '@/providers/permissions';
import { useContactMutations } from './api';

interface PhoneDraft {
  id?: string;
  number: string;
  type: 'mobile' | 'work' | 'home' | 'other';
  isPrimary: boolean;
}
interface EmailDraft {
  id?: string;
  email: string;
  isPrimary: boolean;
}

interface FormState {
  firstName: string;
  lastName: string;
  jobTitle: string;
  companyId: string | null;
  ownerId: string | null;
  source: string;
  tags: string[];
  doNotCall: boolean;
  notes: string;
  phones: PhoneDraft[];
  emails: EmailDraft[];
  customFields: Record<string, unknown>;
}

const EMPTY: FormState = {
  firstName: '',
  lastName: '',
  jobTitle: '',
  companyId: null,
  ownerId: null,
  source: 'manual',
  tags: [],
  doNotCall: false,
  notes: '',
  phones: [{ number: '', type: 'mobile', isPrimary: true }],
  emails: [],
  customFields: {},
};

export function ContactFormDrawer({
  open,
  onOpenChange,
  contact,
  prefillPhone,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  contact?: ContactDto;
  prefillPhone?: string;
  onSaved?: (c: ContactDto) => void;
}) {
  const me = useMe();
  const perms = usePermissions();
  const { create, update } = useContactMutations();
  const definitions = useCustomFields('contact');
  const editing = contact !== undefined;

  const initial = useMemo<FormState>(() => {
    if (contact !== undefined) {
      return {
        firstName: contact.firstName,
        lastName: contact.lastName ?? '',
        jobTitle: contact.jobTitle ?? '',
        companyId: contact.companyId,
        ownerId: contact.ownerId,
        source: contact.source,
        tags: contact.tags,
        doNotCall: contact.doNotCall,
        notes: '',
        phones: contact.phones.map((p) => ({
          id: p.id,
          number: p.display,
          type: p.type,
          isPrimary: p.isPrimary,
        })),
        emails: contact.emails.map((e) => ({ id: e.id, email: e.email, isPrimary: e.isPrimary })),
        customFields: contact.customFields,
      };
    }
    return {
      ...EMPTY,
      ownerId: me.id,
      phones: [{ number: prefillPhone ?? '', type: 'mobile', isPrimary: true }],
    };
  }, [contact, me.id, prefillPhone]);

  const [form, setForm] = useState<FormState>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  useResetWhen(open ? initial : null, () => {
    if (!open) return;
    setForm(initial);
    setErrors({});
    setDirty(false);
  });

  const patch = (p: Partial<FormState>) => {
    setForm((f) => ({ ...f, ...p }));
    setDirty(true);
  };

  const pending = create.isPending || update.isPending;

  const submit = () => {
    const phones = form.phones
      .filter((p) => p.number.trim() !== '')
      .map((p) => ({ number: p.number.trim(), type: p.type, isPrimary: p.isPrimary }));
    const emails = form.emails
      .filter((e) => e.email.trim() !== '')
      .map((e) => ({ email: e.email.trim(), isPrimary: e.isPrimary }));

    const body: Record<string, unknown> = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim() === '' ? null : form.lastName.trim(),
      jobTitle: form.jobTitle.trim() === '' ? null : form.jobTitle.trim(),
      companyId: form.companyId,
      ownerId: form.ownerId,
      tags: form.tags,
      doNotCall: form.doNotCall,
      customFields: form.customFields,
    };
    if (!editing) {
      body.source = form.source;
      body.phones = phones;
      body.emails = emails;
      if (form.notes.trim() !== '') body.notes = form.notes.trim();
    }

    // Same schema as the server, so the messages match before a request is even made.
    const schema = editing ? updateContactBody : createContactBody;
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[issue.path.join('.')] = issue.message;
      setErrors(next);
      focusFirstError(next);
      return;
    }
    setErrors({});

    const onError = (e: unknown) => {
      if (isApiError(e) && e.fieldIssues.length > 0) {
        const next: Record<string, string> = {};
        for (const issue of e.fieldIssues) next[issue.path] = issue.message;
        setErrors(next);
        focusFirstError(next);
        return;
      }
      toast({ tone: 'danger', title: 'Could not save the contact', description: errorMessage(e) });
    };

    if (editing) {
      update.mutate(
        { id: contact.id, body: parsed.data },
        {
          onSuccess: (c) => {
            toast({ tone: 'success', title: 'Contact saved', description: c.displayName });
            onOpenChange(false);
            onSaved?.(c);
          },
          onError,
        },
      );
    } else {
      create.mutate(parsed.data, {
        onSuccess: (c) => {
          toast({ tone: 'success', title: 'Contact created', description: c.displayName });
          onOpenChange(false);
          onSaved?.(c);
        },
        onError,
      });
    }
  };

  return (
    <Drawer
      open={open}
      onOpenChange={(v) => {
        if (!v && dirty && !window.confirm('Discard your changes?')) return;
        onOpenChange(v);
      }}
      title={editing ? 'Edit contact' : 'New contact'}
      description={editing ? 'PATCH /contacts/:id' : 'POST /contacts'}
      dismissable={!pending}
      footer={
        <>
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button variant="primary" loading={pending} onClick={submit}>
            {editing ? 'Save changes' : 'Create contact'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        noValidate
      >
        {errors.root !== undefined && (
          <p
            role="alert"
            className="rounded-sm bg-[var(--danger-subtle)] px-3 py-2 text-base text-danger"
          >
            {errors.root}
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            autoFocus
            name="firstName"
            label="First name"
            required
            value={form.firstName}
            error={errors.firstName}
            onChange={(e) => {
              patch({ firstName: e.target.value });
            }}
          />
          <Input
            name="lastName"
            label="Last name"
            value={form.lastName}
            error={errors.lastName}
            onChange={(e) => {
              patch({ lastName: e.target.value });
            }}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <CompanyPicker
            value={form.companyId}
            onChange={(v) => {
              patch({ companyId: v });
            }}
            error={errors.companyId}
          />
          <Input
            name="jobTitle"
            label="Job title"
            value={form.jobTitle}
            error={errors.jobTitle}
            onChange={(e) => {
              patch({ jobTitle: e.target.value });
            }}
          />
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Phone numbers</legend>
          {form.phones.map((p, i) => (
            <div key={p.id ?? i} className="flex items-end gap-2">
              <Input
                name={`phones.${String(i)}.number`}
                value={p.number}
                mono
                placeholder="0712 345 678"
                error={errors[`phones.${String(i)}.number`]}
                containerClassName="flex-1"
                description={i === 0 ? 'Normalised to E.164 on save.' : undefined}
                onChange={(e) => {
                  const next = [...form.phones];
                  next[i] = { ...p, number: e.target.value };
                  patch({ phones: next });
                }}
              />
              <Select
                value={p.type}
                ariaLabel="Phone type"
                onChange={(v) => {
                  const next = [...form.phones];
                  next[i] = { ...p, type: v as PhoneDraft['type'] };
                  patch({ phones: next });
                }}
                options={[
                  { value: 'mobile', label: 'Mobile' },
                  { value: 'work', label: 'Work' },
                  { value: 'home', label: 'Home' },
                  { value: 'other', label: 'Other' },
                ]}
                className="w-[110px]"
              />
              <Button
                size="sm"
                variant={p.isPrimary ? 'primary' : 'secondary'}
                onClick={() => {
                  patch({ phones: form.phones.map((x, j) => ({ ...x, isPrimary: j === i })) });
                }}
                title="Primary number"
              >
                Primary
              </Button>
              {form.phones.length > 1 && (
                <IconButton
                  icon={Trash2}
                  label="Remove number"
                  variant="ghost"
                  onClick={() => {
                    patch({ phones: form.phones.filter((_, j) => j !== i) });
                  }}
                />
              )}
            </div>
          ))}
          {!editing && (
            <Button
              size="sm"
              variant="ghost"
              icon={Plus}
              className="self-start"
              onClick={() => {
                patch({
                  phones: [...form.phones, { number: '', type: 'mobile', isPrimary: false }],
                });
              }}
            >
              Add number
            </Button>
          )}
          {editing && (
            <p className="text-sm text-faint">
              Numbers are managed from the contact page after creation.
            </p>
          )}
        </fieldset>

        {!editing && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Email addresses</legend>
            {form.emails.map((e, i) => (
              <div key={i} className="flex items-end gap-2">
                <Input
                  name={`emails.${String(i)}.email`}
                  type="email"
                  value={e.email}
                  error={errors[`emails.${String(i)}.email`]}
                  containerClassName="flex-1"
                  onChange={(ev) => {
                    const next = [...form.emails];
                    next[i] = { ...e, email: ev.target.value };
                    patch({ emails: next });
                  }}
                />
                <IconButton
                  icon={Trash2}
                  label="Remove email"
                  variant="ghost"
                  onClick={() => {
                    patch({ emails: form.emails.filter((_, j) => j !== i) });
                  }}
                />
              </div>
            ))}
            <Button
              size="sm"
              variant="ghost"
              icon={Plus}
              className="self-start"
              onClick={() => {
                patch({
                  emails: [...form.emails, { email: '', isPrimary: form.emails.length === 0 }],
                });
              }}
            >
              Add email
            </Button>
          </fieldset>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <OwnerPicker
            value={form.ownerId}
            onChange={(v) => {
              patch({ ownerId: v });
            }}
            disabled={!perms.has('contact:assign')}
            error={errors.ownerId}
          />
          {!editing && (
            <Select
              label="Source"
              value={form.source}
              onChange={(v) => {
                patch({ source: v });
              }}
              options={[
                { value: 'manual', label: 'Manual' },
                { value: 'import', label: 'Import' },
                { value: 'webform', label: 'Web form' },
                { value: 'call', label: 'Call' },
                { value: 'whatsapp', label: 'WhatsApp' },
                { value: 'lead', label: 'Lead' },
                { value: 'other', label: 'Other' },
              ]}
            />
          )}
        </div>

        <TagInput
          value={form.tags}
          onChange={(v) => {
            patch({ tags: v });
          }}
          error={errors.tags}
        />

        <Switch
          checked={form.doNotCall}
          onChange={(v) => {
            patch({ doNotCall: v });
          }}
          label="Do not call"
          description="Blocks click-to-dial for everyone without the override permission."
        />

        {!editing && (
          <Textarea
            label="First note"
            value={form.notes}
            rows={2}
            maxLength={20000}
            placeholder="Optional. Saved as the first note on the timeline."
            onChange={(e) => {
              patch({ notes: e.target.value });
            }}
          />
        )}

        <CustomFieldsForm
          definitions={definitions.data ?? []}
          values={form.customFields}
          errors={errors}
          onChange={(v) => {
            patch({ customFields: v });
          }}
        />
      </form>
    </Drawer>
  );
}

/** Focuses the first field the server or the schema complained about. */
function focusFirstError(errors: Record<string, string>): void {
  const first = Object.keys(errors)[0];
  if (first === undefined) return;
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>(`[name="${CSS.escape(first)}"]`);
    el?.focus();
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
}
