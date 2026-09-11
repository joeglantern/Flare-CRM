/**
 * Lead create and edit (Leads · Create / Edit), in a right-hand drawer.
 *
 * The create schema requires a phone or an email and reports the failure on `phone`, so that
 * message lands under the phone field exactly as the server would report it.
 * Status is not on the create body: a new lead is always `new`. Only edit can change it.
 */
import { createLeadBody, updateLeadBody, type LeadDto } from '@crm/shared';
import { useMemo, useState } from 'react';
import { useResetWhen } from '@/lib/hooks';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Drawer } from '@/components/ui/Overlay';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/toast';
import { CustomFieldsForm } from '@/components/entity/CustomFields';
import { OwnerPicker } from '@/components/entity/pickers';
import { useCustomFields } from '@/features/settings/api';
import { errorMessage } from '@/lib/api/errors';
import { useMe } from '@/lib/auth/me';
import { focusFirstError, serverFieldErrors, zodFieldErrors } from '@/lib/forms';
import { useLeadMutations } from './api';

const SOURCES = [
  { value: 'manual', label: 'Manual' },
  { value: 'webform', label: 'Web form' },
  { value: 'import', label: 'Import' },
  { value: 'call', label: 'Call' },
  { value: 'chat', label: 'Chat' },
];

const STATUSES = [
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'unqualified', label: 'Unqualified' },
];

interface FormState {
  firstName: string;
  lastName: string;
  companyName: string;
  phone: string;
  email: string;
  source: string;
  status: string;
  ownerId: string | null;
  notes: string;
  customFields: Record<string, unknown>;
}

const EMPTY: FormState = {
  firstName: '',
  lastName: '',
  companyName: '',
  phone: '',
  email: '',
  source: 'manual',
  status: 'new',
  ownerId: null,
  notes: '',
  customFields: {},
};

export function LeadFormDrawer({
  open,
  onOpenChange,
  lead,
  prefillPhone,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  lead?: LeadDto;
  prefillPhone?: string;
  onSaved?: (l: LeadDto) => void;
}) {
  const me = useMe();
  const { create, update } = useLeadMutations();
  const definitions = useCustomFields('lead');
  const editing = lead !== undefined;
  const converted = lead?.convertedAt !== null && lead?.convertedAt !== undefined;

  const initial = useMemo<FormState>(() => {
    if (lead !== undefined) {
      return {
        firstName: lead.firstName,
        lastName: lead.lastName ?? '',
        companyName: lead.companyName ?? '',
        phone: lead.phoneDisplay ?? lead.phone ?? '',
        email: lead.email ?? '',
        source: lead.source,
        status: lead.status === 'converted' ? 'qualified' : lead.status,
        ownerId: lead.ownerId,
        notes: lead.notes ?? '',
        customFields: lead.customFields,
      };
    }
    return { ...EMPTY, phone: prefillPhone ?? '', ownerId: me.id };
  }, [lead, me.id, prefillPhone]);

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
    const trimmed = (v: string) => (v.trim() === '' ? null : v.trim());
    const body: Record<string, unknown> = {
      firstName: form.firstName.trim(),
      lastName: trimmed(form.lastName),
      companyName: trimmed(form.companyName),
      phone: trimmed(form.phone),
      email: trimmed(form.email),
      ownerId: form.ownerId,
      notes: trimmed(form.notes),
      customFields: form.customFields,
    };
    if (editing) {
      body.status = form.status;
    } else {
      body.source = form.source;
    }

    const schema = editing ? updateLeadBody : createLeadBody;
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      const next = zodFieldErrors(parsed.error);
      setErrors(next);
      focusFirstError(next);
      return;
    }
    setErrors({});

    const onError = (e: unknown) => {
      const fields = serverFieldErrors(e);
      if (fields !== null) {
        setErrors(fields);
        focusFirstError(fields);
        return;
      }
      toast({ tone: 'danger', title: 'Could not save the lead', description: errorMessage(e) });
    };

    const done = (l: LeadDto, verb: string) => {
      toast({
        tone: 'success',
        title: `Lead ${verb}`,
        description: `${l.firstName} ${l.lastName ?? ''}`.trim(),
      });
      onOpenChange(false);
      onSaved?.(l);
    };

    if (editing) {
      update.mutate(
        { id: lead.id, body: parsed.data },
        {
          onSuccess: (l) => {
            done(l, 'saved');
          },
          onError,
        },
      );
    } else {
      create.mutate(parsed.data, {
        onSuccess: (l) => {
          done(l, 'created');
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
      title={editing ? 'Edit lead' : 'New lead'}
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
          <Button variant="primary" loading={pending} disabled={converted} onClick={submit}>
            {editing ? 'Save changes' : 'Create lead'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {converted && (
          <p className="rounded-sm border border-border bg-surface px-3 py-2 text-sm text-muted">
            This lead has already been converted. It is kept read only so the audit trail stays
            intact.
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Input
            autoFocus
            required
            name="firstName"
            label="First name"
            value={form.firstName}
            error={errors.firstName}
            disabled={converted}
            onChange={(e) => {
              patch({ firstName: e.target.value });
            }}
          />
          <Input
            name="lastName"
            label="Last name"
            value={form.lastName}
            error={errors.lastName}
            disabled={converted}
            onChange={(e) => {
              patch({ lastName: e.target.value });
            }}
          />
        </div>

        <Input
          name="companyName"
          label="Company"
          value={form.companyName}
          error={errors.companyName}
          description="Free text. A company record is only created when the lead is converted."
          disabled={converted}
          onChange={(e) => {
            patch({ companyName: e.target.value });
          }}
        />

        <div className="grid grid-cols-2 gap-3">
          <Input
            name="phone"
            label="Phone"
            mono
            value={form.phone}
            error={errors.phone}
            placeholder="0712 345 678"
            disabled={converted}
            onChange={(e) => {
              patch({ phone: e.target.value });
            }}
          />
          <Input
            name="email"
            label="Email"
            type="email"
            value={form.email}
            error={errors.email}
            disabled={converted}
            onChange={(e) => {
              patch({ email: e.target.value });
            }}
          />
        </div>
        <p className="-mt-2 text-sm text-faint">A phone number or an email is required.</p>

        <div className="grid grid-cols-2 gap-3">
          {editing ? (
            <Select
              label="Status"
              value={form.status}
              options={STATUSES}
              disabled={converted}
              error={errors.status}
              onChange={(v) => {
                patch({ status: v });
              }}
            />
          ) : (
            <Select
              label="Source"
              value={form.source}
              options={SOURCES}
              error={errors.source}
              onChange={(v) => {
                patch({ source: v });
              }}
            />
          )}
          <OwnerPicker
            value={form.ownerId}
            onChange={(v) => {
              patch({ ownerId: v });
            }}
            disabled={converted}
            error={errors.ownerId}
          />
        </div>

        <Textarea
          name="notes"
          label="Notes"
          rows={4}
          value={form.notes}
          error={errors.notes}
          disabled={converted}
          onChange={(e) => {
            patch({ notes: e.target.value });
          }}
        />

        {(definitions.data ?? []).length > 0 && (
          <CustomFieldsForm
            definitions={definitions.data ?? []}
            values={form.customFields}
            errors={errors}
            onChange={(v) => {
              patch({ customFields: v });
            }}
          />
        )}
      </div>
    </Drawer>
  );
}
