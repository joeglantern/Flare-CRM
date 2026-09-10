/**
 * Adding a customer. The slug is what their subdomain is built from, so it is shown as the domain
 * it will become rather than as a slug field with rules nobody reads.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Dialog, Input, Select, toast } from '@crm/ui';
import { http } from '@/lib/api';
import { ApiError } from '@/lib/errors';
import { qk } from '@/lib/query';
import type { ConsoleSettings, Customer, Plan } from '@/lib/types';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/**
 * Mounted only while it is open, so every field starts empty on the next opening without an effect
 * clearing them one by one.
 */
export function NewCustomerDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (customer: Customer) => void;
}) {
  if (!open) return null;
  return <NewCustomerForm onOpenChange={onOpenChange} onCreated={onCreated} />;
}

function NewCustomerForm({
  onOpenChange,
  onCreated,
}: {
  onOpenChange: (v: boolean) => void;
  onCreated: (customer: Customer) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [chosenPlanId, setPlanId] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const plans = useQuery({
    queryKey: qk.plans(),
    queryFn: async () => (await http.list<Plan>('/api/v1/plans')).data,
  });
  const settings = useQuery({
    queryKey: qk.settings(),
    queryFn: () => http.get<ConsoleSettings>('/api/v1/console/settings'),
  });

  // Until somebody picks one, the default plan is the answer, so it is derived rather than stored.
  const planId =
    chosenPlanId ?? plans.data?.find((p) => p.isDefault)?.id ?? plans.data?.[0]?.id ?? null;

  const create = useMutation({
    mutationFn: () =>
      http.post<Customer>('/api/v1/customers', {
        name: name.trim(),
        slug,
        contactName: contactName.trim(),
        contactEmail: contactEmail.trim(),
        ...(contactPhone.trim() === '' ? {} : { contactPhone: contactPhone.trim() }),
        ...(planId === null ? {} : { planId }),
      }),
    onSuccess: async (customer) => {
      await queryClient.invalidateQueries({ queryKey: qk.fleet() });
      toast({ tone: 'success', title: `${customer.name} added` });
      onOpenChange(false);
      onCreated(customer);
    },
    onError: (error: Error) => {
      if (error instanceof ApiError) {
        const issues = error.fieldIssues;
        if (issues.length > 0) {
          setFieldErrors(Object.fromEntries(issues.map((i) => [i.path, i.message])));
          return;
        }
        if (error.isConflict) {
          setFieldErrors({ slug: error.message });
          return;
        }
      }
      toast({ tone: 'danger', title: 'Could not add that customer', description: error.message });
    },
  });

  const brand = settings.data?.brandDomain ?? '';
  const ready =
    name.trim() !== '' && slug !== '' && contactName.trim() !== '' && contactEmail.trim() !== '';

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title="New customer"
      description="They get a subdomain straight away. A domain of their own can be added later."
      width={520}
      footer={
        <>
          <Button
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={create.isPending}
            disabled={!ready}
            onClick={() => {
              create.mutate();
            }}
          >
            Add customer
          </Button>
        </>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) create.mutate();
        }}
      >
        <Input
          autoFocus
          label="Business name"
          value={name}
          error={fieldErrors.name}
          onChange={(e) => {
            setName(e.target.value);
            if (!slugEdited) setSlug(slugify(e.target.value));
          }}
        />
        <Input
          label="Their address"
          description={
            slug === '' ? 'Letters, numbers and hyphens.' : `They will sign in at ${slug}.${brand}`
          }
          mono
          value={slug}
          error={fieldErrors.slug}
          onChange={(e) => {
            setSlugEdited(true);
            setSlug(slugify(e.target.value));
          }}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Contact name"
            value={contactName}
            error={fieldErrors.contactName}
            onChange={(e) => {
              setContactName(e.target.value);
            }}
          />
          <Input
            label="Contact email"
            type="email"
            value={contactEmail}
            error={fieldErrors.contactEmail}
            onChange={(e) => {
              setContactEmail(e.target.value);
            }}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Contact phone"
            description="Optional."
            value={contactPhone}
            error={fieldErrors.contactPhone}
            onChange={(e) => {
              setContactPhone(e.target.value);
            }}
          />
          <Select
            label="Plan"
            value={planId}
            onChange={setPlanId}
            options={(plans.data ?? []).map((p) => ({
              value: p.id,
              label: p.isDefault ? `${p.name} (default)` : p.name,
              description: p.description === '' ? undefined : p.description,
            }))}
            placeholder={plans.isPending ? 'Loading plans…' : 'No plan'}
          />
        </div>
      </form>
    </Dialog>
  );
}
