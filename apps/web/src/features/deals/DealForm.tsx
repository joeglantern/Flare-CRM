/**
 * Deal create and edit drawer (Deals · Create / Edit).
 * A new deal starts in the first open stage of its pipeline, which is what the convert-lead flow
 * relies on too.
 */
import { createDealBody, updateDealBody, type DealDto } from '@crm/shared';
import { useMemo, useState } from 'react';
import { useResetWhen } from '@/lib/hooks';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Drawer } from '@/components/ui/Overlay';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/toast';
import { CustomFieldsForm } from '@/components/entity/CustomFields';
import { CompanyPicker, ContactPicker, OwnerPicker } from '@/components/entity/pickers';
import { useCustomFields } from '@/features/settings/api';
import { errorMessage, isApiError } from '@/lib/api/errors';
import { useMe } from '@/lib/auth/me';
import { useSettings } from '@/providers/settings';
import { useDealMutations, usePipelines } from './api';

interface DealFormState {
  title: string;
  pipelineId: string | null;
  stageId: string | null;
  value: string;
  expectedCloseDate: string;
  contactId: string | null;
  companyId: string | null;
  ownerId: string | null;
  customFields: Record<string, unknown>;
}

export interface DealDefaults {
  contactId?: string | null;
  companyId?: string | null;
  pipelineId?: string;
  stageId?: string;
  title?: string;
  value?: number;
}

export function DealFormDrawer({
  open,
  onOpenChange,
  deal,
  defaults,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  deal?: DealDto;
  defaults?: DealDefaults;
  onSaved?: (d: DealDto) => void;
}) {
  const me = useMe();
  const settings = useSettings();
  const pipelines = usePipelines();
  const definitions = useCustomFields('deal');
  const { create, update } = useDealMutations();
  const editing = deal !== undefined;

  const firstPipeline = pipelines.data?.find((p) => p.isDefault) ?? pipelines.data?.[0];
  const initial = useMemo<DealFormState>(
    () => ({
      title: deal?.title ?? defaults?.title ?? '',
      pipelineId: deal?.pipelineId ?? defaults?.pipelineId ?? firstPipeline?.id ?? null,
      stageId: deal?.stage.id ?? defaults?.stageId ?? null,
      value:
        deal?.value != null
          ? String(deal.value)
          : defaults?.value != null
            ? String(defaults.value)
            : '',
      expectedCloseDate: deal?.expectedCloseDate?.slice(0, 10) ?? '',
      contactId: deal?.contactId ?? defaults?.contactId ?? null,
      companyId: deal?.companyId ?? defaults?.companyId ?? null,
      ownerId: deal?.ownerId ?? me.id,
      customFields: deal?.customFields ?? {},
    }),
    [deal, defaults, firstPipeline?.id, me.id],
  );

  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useResetWhen(open ? initial : null, () => {
    if (!open) return;
    setForm(initial);
    setErrors({});
  });

  const pipeline = pipelines.data?.find((p) => p.id === form.pipelineId);
  const stages = pipeline?.stages ?? [];
  const pending = create.isPending || update.isPending;

  const submit = () => {
    const stageId =
      form.stageId ?? stages.find((s) => s.type === 'open')?.id ?? stages[0]?.id ?? null;
    const body: Record<string, unknown> = {
      title: form.title.trim(),
      pipelineId: form.pipelineId,
      stageId,
      value: form.value === '' ? 0 : Number(form.value),
      currency: settings.currency,
      expectedCloseDate: form.expectedCloseDate === '' ? null : form.expectedCloseDate,
      contactId: form.contactId,
      companyId: form.companyId,
      ownerId: form.ownerId,
      customFields: form.customFields,
    };
    if (editing) {
      delete body.pipelineId;
      delete body.stageId;
    }

    const parsed = (editing ? updateDealBody : createDealBody).safeParse(body);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const i of parsed.error.issues) next[i.path.join('.')] = i.message;
      setErrors(next);
      return;
    }
    setErrors({});

    const onError = (e: unknown) => {
      if (isApiError(e) && e.fieldIssues.length > 0) {
        const next: Record<string, string> = {};
        for (const i of e.fieldIssues) next[i.path] = i.message;
        setErrors(next);
        return;
      }
      toast({ tone: 'danger', title: 'Could not save the deal', description: errorMessage(e) });
    };
    const onSuccess = (d: DealDto) => {
      toast({
        tone: 'success',
        title: editing ? 'Deal saved' : 'Deal created',
        description: d.title,
      });
      onOpenChange(false);
      onSaved?.(d);
    };

    if (editing) update.mutate({ id: deal.id, body: parsed.data }, { onSuccess, onError });
    else create.mutate(parsed.data, { onSuccess, onError });
  };

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? 'Edit deal' : 'New deal'}
      description={editing ? 'PATCH /deals/:id' : 'POST /deals'}
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
            {editing ? 'Save changes' : 'Create deal'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        noValidate
      >
        <Input
          autoFocus
          name="title"
          label="Deal title"
          required
          value={form.title}
          error={errors.title}
          onChange={(e) => {
            setForm((f) => ({ ...f, title: e.target.value }));
          }}
        />

        {!editing && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Pipeline"
              value={form.pipelineId}
              onChange={(v) => {
                setForm((f) => ({ ...f, pipelineId: v, stageId: null }));
              }}
              options={(pipelines.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
              error={errors.pipelineId}
            />
            <Select
              label="Stage"
              value={form.stageId ?? stages.find((s) => s.type === 'open')?.id ?? null}
              onChange={(v) => {
                setForm((f) => ({ ...f, stageId: v }));
              }}
              options={stages.map((s) => ({
                value: s.id,
                label: s.name,
                description: `${String(s.probability)}% · ${s.type}`,
              }))}
              error={errors.stageId}
            />
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            name="value"
            type="number"
            label={`Value (${settings.currency})`}
            value={form.value}
            error={errors.value}
            onChange={(e) => {
              setForm((f) => ({ ...f, value: e.target.value }));
            }}
          />
          <Input
            name="expectedCloseDate"
            type="date"
            label="Expected close"
            value={form.expectedCloseDate}
            error={errors.expectedCloseDate}
            onChange={(e) => {
              setForm((f) => ({ ...f, expectedCloseDate: e.target.value }));
            }}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <ContactPicker
            value={form.contactId}
            error={errors.contactId}
            onChange={(v) => {
              setForm((f) => ({ ...f, contactId: v }));
            }}
          />
          <CompanyPicker
            value={form.companyId}
            error={errors.companyId}
            onChange={(v) => {
              setForm((f) => ({ ...f, companyId: v }));
            }}
          />
        </div>

        <OwnerPicker
          value={form.ownerId}
          error={errors.ownerId}
          onChange={(v) => {
            setForm((f) => ({ ...f, ownerId: v }));
          }}
        />

        <CustomFieldsForm
          definitions={definitions.data ?? []}
          values={form.customFields}
          errors={errors}
          onChange={(v) => {
            setForm((f) => ({ ...f, customFields: v }));
          }}
        />
      </form>
    </Drawer>
  );
}
