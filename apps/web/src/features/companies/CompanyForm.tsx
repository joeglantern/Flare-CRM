/**
 * Company create and edit (Companies · Create / Edit), in a right-hand drawer.
 * Validation is the shared Zod schema; a 422 lands inline on the field the server named.
 *
 * GAP-06: there is no `domain` and no `size` on the DTO. Website is a full URL and company size
 * lives as a custom field, so it is rendered by the custom fields block, not hard coded here.
 */
import { createCompanyBody, updateCompanyBody, type CompanyDto } from '@crm/shared';
import { useMemo, useState } from 'react';
import { useResetWhen } from '@/lib/hooks';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Drawer } from '@/components/ui/Overlay';
import { toast } from '@/components/ui/toast';
import { CustomFieldsForm } from '@/components/entity/CustomFields';
import { OwnerPicker } from '@/components/entity/pickers';
import { useCustomFields } from '@/features/settings/api';
import { errorMessage } from '@/lib/api/errors';
import { useMe } from '@/lib/auth/me';
import { focusFirstError, serverFieldErrors, zodFieldErrors } from '@/lib/forms';
import { useCompanyMutations } from './api';

interface FormState {
  name: string;
  industry: string;
  website: string;
  phone: string;
  email: string;
  line1: string;
  city: string;
  region: string;
  postalCode: string;
  ownerId: string | null;
  customFields: Record<string, unknown>;
}

const EMPTY: FormState = {
  name: '',
  industry: '',
  website: '',
  phone: '',
  email: '',
  line1: '',
  city: '',
  region: '',
  postalCode: '',
  ownerId: null,
  customFields: {},
};

export function CompanyFormDrawer({
  open,
  onOpenChange,
  company,
  prefillName,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  company?: CompanyDto;
  prefillName?: string;
  onSaved?: (c: CompanyDto) => void;
}) {
  const me = useMe();
  const { create, update } = useCompanyMutations();
  const definitions = useCustomFields('company');
  const editing = company !== undefined;

  const initial = useMemo<FormState>(() => {
    if (company !== undefined) {
      return {
        name: company.name,
        industry: company.industry ?? '',
        website: company.website ?? '',
        phone: company.phoneDisplay ?? company.phone ?? '',
        email: company.email ?? '',
        line1: company.address?.line1 ?? '',
        city: company.address?.city ?? '',
        region: company.address?.region ?? '',
        postalCode: company.address?.postalCode ?? '',
        ownerId: company.ownerId,
        customFields: company.customFields,
      };
    }
    return { ...EMPTY, name: prefillName ?? '', ownerId: me.id };
  }, [company, me.id, prefillName]);

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
    const address =
      form.line1.trim() === '' &&
      form.city.trim() === '' &&
      form.region.trim() === '' &&
      form.postalCode.trim() === ''
        ? null
        : {
            ...(form.line1.trim() !== '' ? { line1: form.line1.trim() } : {}),
            ...(form.city.trim() !== '' ? { city: form.city.trim() } : {}),
            ...(form.region.trim() !== '' ? { region: form.region.trim() } : {}),
            ...(form.postalCode.trim() !== '' ? { postalCode: form.postalCode.trim() } : {}),
            country: 'KE',
          };

    const body: Record<string, unknown> = {
      name: form.name.trim(),
      industry: trimmed(form.industry),
      website: trimmed(form.website),
      phone: trimmed(form.phone),
      email: trimmed(form.email),
      address,
      ownerId: form.ownerId,
      customFields: form.customFields,
    };

    const schema = editing ? updateCompanyBody : createCompanyBody;
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
      toast({ tone: 'danger', title: 'Could not save the company', description: errorMessage(e) });
    };

    const done = (c: CompanyDto, verb: string) => {
      toast({ tone: 'success', title: `Company ${verb}`, description: c.name });
      onOpenChange(false);
      onSaved?.(c);
    };

    if (editing) {
      update.mutate(
        { id: company.id, body: parsed.data },
        {
          onSuccess: (c) => {
            done(c, 'saved');
          },
          onError,
        },
      );
    } else {
      create.mutate(parsed.data, {
        onSuccess: (c) => {
          done(c, 'created');
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
      title={editing ? 'Edit company' : 'New company'}
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
            {editing ? 'Save changes' : 'Create company'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          autoFocus
          required
          name="name"
          label="Company name"
          value={form.name}
          error={errors.name}
          onChange={(e) => {
            patch({ name: e.target.value });
          }}
        />

        <div className="grid grid-cols-2 gap-3">
          <Input
            name="industry"
            label="Industry"
            value={form.industry}
            error={errors.industry}
            placeholder="Logistics"
            onChange={(e) => {
              patch({ industry: e.target.value });
            }}
          />
          <Input
            name="website"
            label="Website"
            value={form.website}
            error={errors.website}
            placeholder="https://example.co.ke"
            description="Full URL including https"
            onChange={(e) => {
              patch({ website: e.target.value });
            }}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input
            name="phone"
            label="Main line"
            value={form.phone}
            error={errors.phone}
            placeholder="0207 654 321"
            mono
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
            placeholder="info@example.co.ke"
            onChange={(e) => {
              patch({ email: e.target.value });
            }}
          />
        </div>

        <OwnerPicker
          value={form.ownerId}
          onChange={(v) => {
            patch({ ownerId: v });
          }}
          label="Owner"
          error={errors.ownerId}
        />

        <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3">
          <legend className="px-1 text-sm font-medium">Address</legend>
          <Input
            name="address.line1"
            label="Street"
            value={form.line1}
            error={errors['address.line1']}
            onChange={(e) => {
              patch({ line1: e.target.value });
            }}
          />
          <div className="grid grid-cols-3 gap-3">
            <Input
              name="address.city"
              label="City"
              value={form.city}
              error={errors['address.city']}
              onChange={(e) => {
                patch({ city: e.target.value });
              }}
            />
            <Input
              name="address.region"
              label="County"
              value={form.region}
              error={errors['address.region']}
              onChange={(e) => {
                patch({ region: e.target.value });
              }}
            />
            <Input
              name="address.postalCode"
              label="Postal code"
              value={form.postalCode}
              error={errors['address.postalCode']}
              onChange={(e) => {
                patch({ postalCode: e.target.value });
              }}
            />
          </div>
        </fieldset>

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
