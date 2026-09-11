/**
 * Lead conversion (Flows · Lead to deal). One POST /leads/:id/convert creates the contact,
 * optionally the company and the deal, and returns all three ids so we can offer every landing spot.
 *
 * Not optimistic: conversion writes several rows and is not idempotent, so the dialog waits for the
 * server and only then navigates.
 */
import { convertLeadBody, type LeadDto } from '@crm/shared';
import { useNavigate } from '@tanstack/react-router';
import { ArrowRight, Building2, Kanban, UserRound } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useResetWhen } from '@/lib/hooks';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Dialog } from '@/components/ui/Overlay';
import { Select } from '@/components/ui/Select';
import { Checkbox } from '@/components/ui/Toggle';
import { toast } from '@/components/ui/toast';
import { ContactPicker, OwnerPicker } from '@/components/entity/pickers';
import { usePipelines } from '@/features/deals/api';
import { errorMessage } from '@/lib/api/errors';
import { focusFirstError, serverFieldErrors, zodFieldErrors } from '@/lib/forms';
import { linkTo } from '@/lib/links';
import { useLeadMutations } from './api';

export function ConvertLeadDialog({
  open,
  onOpenChange,
  lead,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  lead: LeadDto;
}) {
  const navigate = useNavigate();
  const { convert } = useLeadMutations();
  const pipelines = usePipelines();

  const defaultPipeline = useMemo(
    () => (pipelines.data ?? []).find((p) => p.isDefault) ?? (pipelines.data ?? [])[0] ?? null,
    [pipelines.data],
  );

  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [existingContactId, setExistingContactId] = useState<string | null>(null);
  const [createCompany, setCreateCompany] = useState(
    lead.companyName !== null && lead.companyName !== '',
  );
  const [createDeal, setCreateDeal] = useState(true);
  const [dealTitle, setDealTitle] = useState('');
  const [dealValue, setDealValue] = useState('');
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const [expectedCloseDate, setExpectedCloseDate] = useState('');
  const [ownerId, setOwnerId] = useState<string | null>(lead.ownerId);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useResetWhen(open ? defaultPipeline : null, () => {
    if (!open) return;
    setMode('new');
    setExistingContactId(null);
    setCreateCompany(lead.companyName !== null && lead.companyName !== '');
    setCreateDeal(true);
    setDealTitle(
      lead.companyName !== null && lead.companyName !== ''
        ? `${lead.companyName} opportunity`
        : `${lead.firstName} ${lead.lastName ?? ''}`.trim(),
    );
    setDealValue('');
    setPipelineId(defaultPipeline?.id ?? null);
    setExpectedCloseDate('');
    setOwnerId(lead.ownerId);
    setErrors({});
  });

  const submit = () => {
    const body: Record<string, unknown> = {
      createCompany,
      createDeal,
      ownerId,
    };
    if (mode === 'existing' && existingContactId !== null)
      body.existingContactId = existingContactId;
    if (createDeal) {
      if (dealTitle.trim() !== '') body.dealTitle = dealTitle.trim();
      if (dealValue.trim() !== '') body.dealValue = Number(dealValue);
      if (pipelineId !== null) body.pipelineId = pipelineId;
      if (expectedCloseDate !== '') body.expectedCloseDate = expectedCloseDate;
    }

    if (mode === 'existing' && existingContactId === null) {
      const next = { existingContactId: 'Choose the contact this lead belongs to.' };
      setErrors(next);
      focusFirstError(next);
      return;
    }

    const parsed = convertLeadBody.safeParse(body);
    if (!parsed.success) {
      const next = zodFieldErrors(parsed.error);
      setErrors(next);
      focusFirstError(next);
      return;
    }
    setErrors({});

    convert.mutate(
      { id: lead.id, body: parsed.data },
      {
        onSuccess: (r) => {
          toast({
            tone: 'success',
            title: 'Lead converted',
            description:
              r.dealId !== null
                ? 'Contact and deal created.'
                : 'Contact created. No deal was opened.',
            action:
              r.dealId !== null
                ? {
                    label: 'Open deal',
                    onClick: () => {
                      void navigate(linkTo.deal(r.dealId ?? ''));
                    },
                  }
                : undefined,
          });
          onOpenChange(false);
          void navigate(r.dealId !== null ? linkTo.deal(r.dealId) : linkTo.contact(r.contactId));
        },
        onError: (e) => {
          const fields = serverFieldErrors(e);
          if (fields !== null) {
            setErrors(fields);
            focusFirstError(fields);
            return;
          }
          toast({
            tone: 'danger',
            title: 'Could not convert the lead',
            description: errorMessage(e),
          });
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Convert lead"

      width={520}
      dismissable={!convert.isPending}
      footer={
        <>
          <Button
            variant="ghost"
            disabled={convert.isPending}
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button variant="primary" icon={ArrowRight} loading={convert.isPending} onClick={submit}>
            Convert
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <section className="flex flex-col gap-2">
          <h4 className="flex items-center gap-1.5 text-sm font-medium">
            <UserRound size={13} className="text-muted" aria-hidden />
            Contact
          </h4>
          <div className="flex flex-col gap-2 rounded-md border border-border p-3">
            {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- the control is nested inside */}
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="convert-contact-mode"
                checked={mode === 'new'}
                className="mt-0.5"
                onChange={() => {
                  setMode('new');
                }}
              />
              <span className="min-w-0">
                <span className="block text-base">Create a new contact</span>
                <span className="block text-sm text-muted">
                  {`${lead.firstName} ${lead.lastName ?? ''}`.trim()}
                  {lead.phoneDisplay !== null ? ` · ${lead.phoneDisplay}` : ''}
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="convert-contact-mode"
                checked={mode === 'existing'}
                className="mt-0.5"
                onChange={() => {
                  setMode('existing');
                }}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-base">Link to an existing contact</span>
                {mode === 'existing' && (
                  <span className="mt-2 block">
                    <ContactPicker
                      value={existingContactId}
                      onChange={setExistingContactId}
                      error={errors.existingContactId}
                    />
                  </span>
                )}
              </span>
            </label>
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h4 className="flex items-center gap-1.5 text-sm font-medium">
            <Building2 size={13} className="text-muted" aria-hidden />
            Company
          </h4>
          <Checkbox
            checked={createCompany}
            onChange={setCreateCompany}
            disabled={lead.companyName === null || lead.companyName === ''}
            label={
              lead.companyName === null || lead.companyName === ''
                ? 'This lead has no company name'
                : `Create the company ${lead.companyName}`
            }
            description="Skipped if a company with that name already exists."
          />
        </section>

        <section className="flex flex-col gap-2">
          <h4 className="flex items-center gap-1.5 text-sm font-medium">
            <Kanban size={13} className="text-muted" aria-hidden />
            Deal
          </h4>
          <Checkbox
            checked={createDeal}
            onChange={setCreateDeal}
            label="Open a deal from this lead"
          />
          {createDeal && (
            <div className="flex flex-col gap-3 rounded-md border border-border p-3">
              <Input
                name="dealTitle"
                label="Deal title"
                value={dealTitle}
                error={errors.dealTitle}
                onChange={(e) => {
                  setDealTitle(e.target.value);
                }}
              />
              <div className="grid grid-cols-2 gap-3">
                <Input
                  name="dealValue"
                  label="Value"
                  type="number"
                  min={0}
                  mono
                  prefix="KES"
                  value={dealValue}
                  error={errors.dealValue}
                  onChange={(e) => {
                    setDealValue(e.target.value);
                  }}
                />
                <Input
                  name="expectedCloseDate"
                  label="Expected close"
                  type="date"
                  value={expectedCloseDate}
                  error={errors.expectedCloseDate}
                  onChange={(e) => {
                    setExpectedCloseDate(e.target.value);
                  }}
                />
              </div>
              <Select
                label="Pipeline"
                value={pipelineId}
                options={(pipelines.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
                error={errors.pipelineId}
                onChange={setPipelineId}
              />
            </div>
          )}
        </section>

        <OwnerPicker value={ownerId} onChange={setOwnerId} label="Owner of everything created" />
      </div>
    </Dialog>
  );
}
