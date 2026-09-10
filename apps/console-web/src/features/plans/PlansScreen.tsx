/**
 * Plans: the shapes a customer can be sold, so a per-customer override is the exception rather than
 * how every customer is configured.
 *
 * A plan in use cannot be deleted, and the server is the one that refuses; the button simply reports
 * what it says.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';
import {
  FEATURES,
  LIMITS,
  featureKeys,
  limitKeys,
  normaliseFeatures,
  DEFAULT_ENTITLEMENTS,
  type FeatureKey,
  type FeatureMap,
  type LimitKey,
  type LimitMap,
} from '@crm/shared';
import { Badge, Button, ConfirmDialog, Input, Sheet, Switch, Textarea, toast } from '@crm/ui';
import { Table, type Column } from '@/components/Bits';
import { EmptyState, PageHeader, StateSlot, Section } from '@/components/Page';
import { http } from '@/lib/api';
import { limitLabel } from '@/lib/format';
import { qk } from '@/lib/query';
import type { Plan } from '@/lib/types';

export function PlansScreen() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Plan | null>(null);

  const plans = useQuery({
    queryKey: qk.plans(),
    queryFn: async () => (await http.list<Plan>('/api/v1/plans')).data,
  });

  const remove = useMutation({
    mutationFn: (plan: Plan) => http.del(`/api/v1/plans/${plan.id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.plans() });
      toast({ tone: 'success', title: 'Plan deleted' });
    },
    onError: (error: Error) => {
      toast({ tone: 'danger', title: 'Could not delete that plan', description: error.message });
    },
  });

  const columns: Column<Plan>[] = [
    {
      key: 'name',
      header: 'Plan',
      cell: (plan) => (
        <span className="flex flex-col">
          <span className="flex items-center gap-2 font-medium">
            {plan.name}
            {plan.isDefault && (
              <Badge tone="flare" icon={Star}>
                Default
              </Badge>
            )}
          </span>
          {plan.description !== '' && (
            <span className="text-sm text-muted">{plan.description}</span>
          )}
        </span>
      ),
    },
    {
      key: 'features',
      header: 'Features',
      cell: (plan) => {
        const off = featureKeys.filter((k) => !plan.features[k]);
        return off.length === 0 ? (
          <span className="text-base">Everything</span>
        ) : (
          <span className="text-base">
            Everything except {off.map((k) => FEATURES[k].label).join(', ')}
          </span>
        );
      },
    },
    {
      key: 'seats',
      header: 'Seats',
      cell: (plan) => <span className="tnum">{limitLabel(plan.limits.seats, '')}</span>,
    },
    {
      key: 'storage',
      header: 'Storage',
      cell: (plan) => <span className="tnum">{limitLabel(plan.limits.storage_gb, 'GB')}</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'end',
      cell: (plan) => (
        <span className="flex justify-end gap-2">
          <Button
            size="sm"
            icon={Pencil}
            onClick={() => {
              setEditing(plan);
            }}
          >
            Edit
          </Button>
          <Button
            size="sm"
            variant="danger"
            icon={Trash2}
            onClick={() => {
              setDeleting(plan);
            }}
          >
            Delete
          </Button>
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Plans"
        description="What a customer gets by default. Anything specific to one customer is an override on their own screen."
        actions={
          <Button
            variant="primary"
            icon={Plus}
            onClick={() => {
              setEditing('new');
            }}
          >
            New plan
          </Button>
        }
      />

      <StateSlot
        isPending={plans.isPending}
        error={plans.error}
        isEmpty={plans.data?.length === 0}
        empty={
          <EmptyState
            title="No plans yet"
            description="A plan is a starting point for every customer put on it."
            action={
              <Button
                variant="primary"
                icon={Plus}
                onClick={() => {
                  setEditing('new');
                }}
              >
                New plan
              </Button>
            }
          />
        }
        onRetry={() => {
          void plans.refetch();
        }}
      >
        <div className="rounded-md border border-border bg-surface">
          <Table caption="Plans" columns={columns} rows={plans.data ?? []} rowKey={(p) => p.id} />
        </div>
      </StateSlot>

      <PlanEditor
        plan={editing}
        onClose={() => {
          setEditing(null);
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(v) => {
          if (!v) setDeleting(null);
        }}
        title={`Delete ${deleting?.name ?? 'this plan'}?`}
        description="Customers already on it have to be moved to another plan first, and the console will refuse this if any still are."
        confirmLabel="Delete plan"
        loading={remove.isPending}
        onConfirm={() => {
          if (deleting !== null) remove.mutate(deleting);
          setDeleting(null);
        }}
      />
    </>
  );
}

/** Mounted only while a plan is open, so the form starts from that plan and nothing else. */
function PlanEditor({ plan, onClose }: { plan: Plan | 'new' | null; onClose: () => void }) {
  if (plan === null) return null;
  return <PlanForm key={plan === 'new' ? 'new' : plan.id} plan={plan} onClose={onClose} />;
}

function PlanForm({ plan, onClose }: { plan: Plan | 'new'; onClose: () => void }) {
  const queryClient = useQueryClient();
  const isNew = plan === 'new';
  const [name, setName] = useState(isNew ? '' : plan.name);
  const [description, setDescription] = useState(isNew ? '' : plan.description);
  const [isDefault, setIsDefault] = useState(isNew ? false : plan.isDefault);
  const [features, setFeatures] = useState<FeatureMap>(
    isNew ? DEFAULT_ENTITLEMENTS.features : plan.features,
  );
  const [limits, setLimits] = useState<LimitMap>(isNew ? DEFAULT_ENTITLEMENTS.limits : plan.limits);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        description: description.trim(),
        features,
        limits,
        isDefault,
      };
      return plan === 'new'
        ? http.post<Plan>('/api/v1/plans', body)
        : http.patch<Plan>(`/api/v1/plans/${plan.id}`, body);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.plans() });
      await queryClient.invalidateQueries({ queryKey: qk.fleet() });
      toast({ tone: 'success', title: isNew ? 'Plan created' : 'Plan saved' });
      onClose();
    },
    onError: (error: Error) => {
      toast({ tone: 'danger', title: 'Could not save that plan', description: error.message });
    },
  });

  const setFeature = (key: FeatureKey, next: boolean) => {
    // The same rule the server applies: a feature without its prerequisites cannot be on.
    setFeatures(normaliseFeatures({ ...features, [key]: next }));
  };

  const setLimitValue = (key: LimitKey, next: number | null) => {
    setLimits({ ...limits, [key]: next });
  };

  return (
    <Sheet
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      title={isNew ? 'New plan' : `Edit ${name}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={name.trim() === ''}
            onClick={() => {
              save.mutate();
            }}
          >
            {isNew ? 'Create plan' : 'Save plan'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <p className="text-base text-muted">
          Features off here are off for every customer on this plan, unless that customer has an
          override of their own.
        </p>
        <Input
          autoFocus
          label="Name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
        <Textarea
          label="Description"
          rows={2}
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
          }}
        />
        <Switch
          checked={isDefault}
          onChange={setIsDefault}
          label="Use this for new customers"
          description="Only one plan can be the default; setting this moves it."
        />

        <Section title="Features">
          <ul className="flex flex-col divide-y divide-border">
            {featureKeys.map((key) => {
              const missing = FEATURES[key].requires.filter((r) => !features[r]);
              return (
                <li key={key} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-base font-medium">{FEATURES[key].label}</p>
                    <p className="text-sm text-muted">{FEATURES[key].description}</p>
                    {missing.length > 0 && (
                      <p className="text-sm text-warning">
                        Needs {missing.map((m) => FEATURES[m].label).join(' and ')}.
                      </p>
                    )}
                  </div>
                  <Switch
                    checked={features[key]}
                    disabled={missing.length > 0}
                    ariaLabel={FEATURES[key].label}
                    onChange={(next) => {
                      setFeature(key, next);
                    }}
                  />
                </li>
              );
            })}
          </ul>
        </Section>

        <Section title="Limits" description="Empty means no limit.">
          <div className="grid gap-4 sm:grid-cols-2">
            {limitKeys.map((key) => (
              <Input
                key={key}
                type="number"
                min={0}
                label={LIMITS[key].label}
                description={LIMITS[key].description}
                placeholder="No limit"
                value={limits[key] === null ? '' : String(limits[key])}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  setLimitValue(key, raw === '' ? null : Math.max(0, Math.floor(Number(raw))));
                }}
              />
            ))}
          </div>
        </Section>
      </div>
    </Sheet>
  );
}
