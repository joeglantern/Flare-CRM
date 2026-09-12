/**
 * What this customer may use, and sending it to their stack.
 *
 * Saving and issuing are two steps on purpose. Saving records what was agreed; issuing signs a
 * document and pushes it. An owner editing a plan mid-negotiation should not be quietly changing
 * what a live CRM allows on every keystroke.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Send, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { FEATURES, LIMITS, type FeatureKey, type LimitKey } from '@crm/shared';
import { Badge, Button, Input, Select, Switch, Textarea, toast } from '@crm/ui';
import { Field, Fields, IssueStatusBadge } from '@/components/Bits';
import { Section } from '@/components/Page';
import { http } from '@/lib/api';
import { dateTime, daysUntil, fromMinor, money, toMinor } from '@/lib/format';
import { usePermissions } from '@/lib/permissions';
import { qk } from '@/lib/query';
import type { CustomerEntitlements, Issue, Plan, Stack } from '@/lib/types';
import {
  blockedBy,
  dependents,
  effectiveFeatures,
  effectiveLimits,
  featureKeys,
  fromServer,
  isDirty,
  limitKeys,
  parsePercent,
  planFeatures,
  planLimits,
  previewCharge,
  savePayload,
  setFeature,
  setLimit,
  type EditorState,
} from './entitlements-editor';

export function EntitlementsTab({
  customerId,
  entitlements,
  stacks,
  issues,
}: {
  customerId: string;
  entitlements: CustomerEntitlements;
  stacks: Stack[];
  issues: Issue[];
}) {
  const queryClient = useQueryClient();
  // What a customer is sold is an owner's decision. Support sees the agreement and changes none of
  // it, so the fields are shown filled in and fixed rather than hidden.
  const { can } = usePermissions();
  const mayIssue = can('entitlement:issue');
  const [saved, setSaved] = useState<EditorState>(() => fromServer(entitlements));
  const [state, setState] = useState<EditorState>(() => fromServer(entitlements));
  const [source, setSource] = useState(entitlements);

  // The server is the source of truth: a refetch after saving, or a change made elsewhere, replaces
  // what is on screen rather than being merged into it. Done while rendering rather than in an
  // effect, so the new values are drawn in the same pass instead of one frame later.
  if (source !== entitlements) {
    const next = fromServer(entitlements);
    setSource(entitlements);
    setSaved(next);
    setState(next);
  }

  const plans = useQuery({
    queryKey: qk.plans(),
    queryFn: async () => (await http.list<Plan>('/api/v1/plans')).data,
  });
  const plan = plans.data?.find((p) => p.id === state.planId);

  const features = effectiveFeatures(plan, state.featureOverrides);
  const limits = effectiveLimits(plan, state.limitOverrides);
  const base = planFeatures(plan);
  const baseLimits = planLimits(plan);
  const dirty = isDirty(state, saved);
  // A price override is charged in the plan's own currency: two prices in two currencies for one
  // customer is a billing question this console does not answer.
  const currency = plan?.currency ?? entitlements.effective.currency;
  const priceError =
    state.priceMajor.trim() === '' || toMinor(state.priceMajor, currency) !== null
      ? undefined
      : 'A price is a number, and it cannot be negative.';

  const save = useMutation({
    mutationFn: () =>
      http.put(`/api/v1/customers/${customerId}/entitlements`, savePayload(state, currency)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.entitlements(customerId) });
      await queryClient.invalidateQueries({ queryKey: qk.fleet() });
      toast({ tone: 'success', title: 'Saved. Issue it to send it to their stack.' });
    },
    onError: (error: Error) => {
      toast({ tone: 'danger', title: 'Could not save that', description: error.message });
    },
  });

  const issue = useMutation({
    mutationFn: () => http.post<{ issues: Issue[] }>(`/api/v1/customers/${customerId}/issue`),
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: qk.customer(customerId) });
      const connected = stacks.some((s) => s.connected && s.revokedAt === null);
      toast({
        tone: 'success',
        title: connected
          ? `Sent to ${String(data.issues.length)} stack${data.issues.length === 1 ? '' : 's'}`
          : 'Signed and waiting',
        description: connected
          ? undefined
          : 'That stack is offline. It will pick this up the moment it reconnects.',
      });
    },
    onError: (error: Error) => {
      toast({ tone: 'danger', title: 'Could not issue that', description: error.message });
    },
  });

  const outstanding = issues.filter((i) => i.status === 'pending' || i.status === 'delivered');
  const expiryDays = daysUntil(saved.expiryDay === '' ? null : `${saved.expiryDay}T23:59:59`);

  return (
    <div className="flex flex-col gap-5">
      <Section
        title="Agreement"
        description="The plan they are on, when it runs out, and what was agreed."
      >
        <Fields columns={3}>
          <Field label="Plan">
            {mayIssue ? (
              <Select
                ariaLabel="Plan"
                value={state.planId}
                onChange={(planId) => {
                  setState({ ...state, planId });
                }}
                options={(plans.data ?? []).map((p) => ({
                  value: p.id,
                  label: p.isDefault ? `${p.name} (default)` : p.name,
                }))}
                placeholder="No plan"
              />
            ) : (
              <span className="text-base">{plan?.name ?? 'No plan'}</span>
            )}
          </Field>
          <Field label="Expires">
            <Input
              type="date"
              aria-label="Expiry date"
              disabled={!mayIssue}
              value={state.expiryDay}
              onChange={(e) => {
                setState({ ...state, expiryDay: e.target.value });
              }}
            />
            <span className="mt-1 block text-sm text-muted">
              {state.expiryDay === ''
                ? 'No expiry. Their CRM keeps working until you say otherwise.'
                : 'Reads keep working after this date; every change is refused.'}
            </span>
          </Field>
          <Field label="Price a month">
            <Input
              aria-label="Price a month"
              inputMode="decimal"
              disabled={!mayIssue}
              placeholder={fromMinor(plan?.priceMonthlyMinor ?? null, currency) || 'Not sold'}
              error={priceError}
              value={state.priceMajor}
              onChange={(e) => {
                setState({ ...state, priceMajor: e.target.value });
              }}
            />
            <span className="mt-1 block text-sm text-muted">
              {state.priceMajor.trim() === ''
                ? `They pay what the plan charges, ${money(plan?.priceMonthlyMinor ?? null, currency)}.`
                : `${money(toMinor(state.priceMajor, currency), currency)} a month, instead of the plan's ${money(plan?.priceMonthlyMinor ?? null, currency)}.`}
            </span>
          </Field>
          <Field label="Now">
            {expiryDays === null ? (
              <Badge tone="neutral">No expiry</Badge>
            ) : expiryDays < 0 ? (
              <Badge tone="danger">Expired</Badge>
            ) : expiryDays <= 14 ? (
              <Badge tone="warning">{expiryDays} days left</Badge>
            ) : (
              <Badge tone="success">Active</Badge>
            )}
          </Field>
        </Fields>

        <div className="mt-4">
          <Textarea
            label="Agreement notes"
            description="What was agreed, and with whom. Only owners see this."
            rows={3}
            disabled={!mayIssue}
            value={state.agreementNotes}
            onChange={(e) => {
              setState({ ...state, agreementNotes: e.target.value });
            }}
          />
        </div>
      </Section>

      <Commercials
        state={state}
        plan={plan}
        currency={currency}
        readOnly={!mayIssue}
        onChange={setState}
      />

      <Section
        title="Features"
        description="Off means hidden in their app and refused by their server. Data is never deleted, so switching something back on restores it."
      >
        <ul className="flex flex-col divide-y divide-border">
          {featureKeys.map((key) => (
            <FeatureRow
              key={key}
              featureKey={key}
              effective={features[key]}
              overridden={state.featureOverrides[key] !== undefined}
              blocked={blockedBy(key, features)}
              dependants={dependents(key).filter((d) => features[d])}
              readOnly={!mayIssue}
              onChange={(next) => {
                setState(setFeature(state, plan, key, next));
              }}
              onClearOverride={() => {
                setState(setFeature(state, plan, key, base[key]));
              }}
            />
          ))}
        </ul>
      </Section>

      <Section title="Limits" description="Empty means no limit.">
        <div className="grid gap-4 sm:grid-cols-2">
          {limitKeys.map((key) => (
            <LimitRow
              key={key}
              limitKey={key}
              value={limits[key]}
              fromPlan={baseLimits[key]}
              overridden={state.limitOverrides[key] !== undefined}
              readOnly={!mayIssue}
              onChange={(next) => {
                setState(setLimit(state, plan, key, next));
              }}
            />
          ))}
        </div>
      </Section>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface px-4 py-3">
        <div className="min-w-0 text-base text-muted">
          {dirty ? (
            <span>Unsaved changes. Save them, then issue to send them to their stack.</span>
          ) : outstanding.length > 0 ? (
            <span className="flex flex-wrap items-center gap-2">
              Waiting on their stack:
              {outstanding.map((i) => (
                <span key={i.id} className="flex items-center gap-1">
                  <IssueStatusBadge status={i.status} />
                  <span className="text-sm">since {dateTime(i.issuedAt)}</span>
                </span>
              ))}
            </span>
          ) : (
            <span>Saved and up to date with what their stack has applied.</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!mayIssue && (
            <span className="text-base text-muted">
              Changing this needs an owner. You are seeing what was agreed.
            </span>
          )}
          {mayIssue && dirty && (
            <Button
              icon={Undo2}
              onClick={() => {
                setState(saved);
              }}
            >
              Discard
            </Button>
          )}
          {mayIssue && (
            <Button
              loading={save.isPending}
              disabled={!dirty}
              onClick={() => {
                save.mutate();
              }}
            >
              Save
            </Button>
          )}
          {mayIssue && (
            <Button
              variant="primary"
              icon={Send}
              loading={issue.isPending}
              disabled={dirty || stacks.filter((s) => s.revokedAt === null).length === 0}
              title={
                dirty
                  ? 'Save first: issuing signs what is stored, not what is on screen'
                  : 'Sign the current entitlements and send them'
              }
              onClick={() => {
                issue.mutate();
              }}
            >
              Issue and push
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * What this customer actually pays, as opposed to what the plan says on the shelf.
 *
 * A trial is not a hundred percent discount and neither is an expired plan: they end on different
 * days and what is worth chasing about each is different, so they are separate fields. The sentence
 * underneath is the whole point of the section, because three fields that interact are otherwise a
 * puzzle somebody has to solve in their head at renewal time.
 */
function Commercials({
  state,
  plan,
  currency,
  readOnly,
  onChange,
}: {
  state: EditorState;
  plan: Plan | undefined;
  currency: string;
  readOnly: boolean;
  onChange: (next: EditorState) => void;
}) {
  const charge = previewCharge(state, plan, currency);
  const percentError =
    state.discountPercent.trim() === '' || parsePercent(state.discountPercent) !== null
      ? undefined
      : 'A whole percentage between 1 and 100.';

  const sentence =
    charge.state === 'expired'
      ? 'Nothing, while their plan is expired. Their CRM is read only until it is lifted.'
      : charge.state === 'trial'
        ? `Nothing until the trial ends, then ${money(charge.listMinor, currency)} a month.`
        : charge.state === 'discounted'
          ? `${money(charge.chargedMinor, currency)} a month: ${state.discountPercent.trim()} percent off ${money(charge.listMinor, currency)}${state.discountUntilDay === '' ? '' : ` until ${state.discountUntilDay}`}.`
          : `${money(charge.chargedMinor, currency)} a month.`;

  return (
    <Section
      title="Commercials"
      description="What they are actually charged, and when the agreement comes round again."
    >
      <Fields columns={3}>
        <Field label="Trial ends">
          <Input
            type="date"
            aria-label="Trial ends"
            disabled={readOnly}
            value={state.trialDay}
            onChange={(e) => {
              onChange({ ...state, trialDay: e.target.value });
            }}
          />
          <span className="mt-1 block text-sm text-muted">
            They pay nothing until the end of this day, and the full price afterwards.
          </span>
        </Field>
        <Field label="Renews on">
          <Input
            type="date"
            aria-label="Renews on"
            disabled={readOnly}
            value={state.renewsOnDay}
            onChange={(e) => {
              onChange({ ...state, renewsOnDay: e.target.value });
            }}
          />
          <span className="mt-1 block text-sm text-muted">
            Recorded so the overview can say what is coming round this month.
          </span>
        </Field>
        <Field label="Discount">
          <Input
            aria-label="Discount percent"
            inputMode="numeric"
            placeholder="None"
            suffix={<span className="text-sm text-muted">percent</span>}
            error={percentError}
            disabled={readOnly}
            value={state.discountPercent}
            onChange={(e) => {
              onChange({ ...state, discountPercent: e.target.value });
            }}
          />
        </Field>
        <Field label="Discount until">
          <Input
            type="date"
            aria-label="Discount until"
            disabled={readOnly}
            value={state.discountUntilDay}
            onChange={(e) => {
              onChange({ ...state, discountUntilDay: e.target.value });
            }}
          />
          <span className="mt-1 block text-sm text-muted">
            Leave it empty for a discount with no end.
          </span>
        </Field>
        <Field label="Why">
          <Input
            aria-label="Why the discount was given"
            placeholder="Two year commitment"
            disabled={readOnly}
            value={state.discountNote}
            onChange={(e) => {
              onChange({ ...state, discountNote: e.target.value });
            }}
          />
        </Field>
        <Field label="They pay">
          <span className="text-base">{sentence}</span>
        </Field>
      </Fields>
    </Section>
  );
}

function FeatureRow({
  featureKey,
  effective,
  overridden,
  blocked,
  dependants,
  readOnly,
  onChange,
  onClearOverride,
}: {
  featureKey: FeatureKey;
  effective: boolean;
  overridden: boolean;
  blocked: FeatureKey[];
  dependants: FeatureKey[];
  readOnly: boolean;
  onChange: (next: boolean) => void;
  onClearOverride: () => void;
}) {
  const definition = FEATURES[featureKey];
  const prerequisiteOff = blocked.length > 0;
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-base font-medium">{definition.label}</span>
          {overridden ? (
            readOnly ? (
              <Badge tone="neutral">Overridden</Badge>
            ) : (
              <button
                type="button"
                className="text-sm text-flare-link underline underline-offset-2"
                onClick={onClearOverride}
              >
                Overridden, back to plan
              </button>
            )
          ) : (
            <Badge tone="neutral">From plan</Badge>
          )}
        </span>
        <p className="mt-0.5 text-sm text-muted">{definition.description}</p>
        {prerequisiteOff && (
          <p className="mt-1 text-sm text-warning">
            Needs {blocked.map((b) => FEATURES[b].label).join(' and ')}, which{' '}
            {blocked.length === 1 ? 'is' : 'are'} off, so this stays off however this switch is set.
          </p>
        )}
        {effective && dependants.length > 0 && (
          <p className="mt-1 text-sm text-muted">
            Turning this off also takes {dependants.map((d) => FEATURES[d].label).join(' and ')}{' '}
            with it.
          </p>
        )}
      </div>
      <Switch
        checked={effective}
        onChange={onChange}
        disabled={prerequisiteOff || readOnly}
        ariaLabel={definition.label}
      />
    </li>
  );
}

function LimitRow({
  limitKey,
  value,
  fromPlan,
  overridden,
  readOnly,
  onChange,
}: {
  limitKey: LimitKey;
  value: number | null;
  fromPlan: number | null;
  overridden: boolean;
  readOnly: boolean;
  onChange: (next: number | null) => void;
}) {
  const definition = LIMITS[limitKey];
  return (
    <Input
      type="number"
      min={0}
      disabled={readOnly}
      label={
        <span className="flex items-center gap-2">
          {definition.label}
          {overridden ? (
            readOnly ? (
              <Badge tone="neutral">Overridden</Badge>
            ) : (
              <button
                type="button"
                className="text-sm text-flare-link underline underline-offset-2"
                onClick={() => {
                  onChange(fromPlan);
                }}
              >
                back to plan
              </button>
            )
          ) : (
            <Badge tone="neutral">From plan</Badge>
          )}
        </span>
      }
      description={`${definition.description} ${value === null ? 'No limit.' : ''}`.trim()}
      placeholder="No limit"
      suffix={
        definition.unit === '' ? undefined : (
          <span className="text-sm text-muted">{definition.unit}</span>
        )
      }
      value={value === null ? '' : String(value)}
      onChange={(e) => {
        const raw = e.target.value.trim();
        onChange(raw === '' ? null : Math.max(0, Math.floor(Number(raw))));
      }}
    />
  );
}
