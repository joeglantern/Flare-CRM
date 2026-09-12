/**
 * Plans: the shapes a customer can be sold, so a per-customer override is the exception rather than
 * how every customer is configured.
 *
 * A plan in use cannot be deleted, and the server is the one that refuses; the button simply reports
 * what it says.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Pencil, Plus, Star, Trash2 } from 'lucide-react';
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
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  Input,
  Sheet,
  Switch,
  Textarea,
  toast,
} from '@crm/ui';
import { Pager, Table, type Column } from '@/components/Bits';
import { EmptyState, PageHeader, StateSlot, Section } from '@/components/Page';
import { http } from '@/lib/api';
import { fromMinor, isCurrency, limitLabel, money, toMinor } from '@/lib/format';
import { usePermissions } from '@/lib/permissions';
import { qk } from '@/lib/query';
import type { Plan, PlanCustomer } from '@/lib/types';
import { Link } from '@tanstack/react-router';

export function PlansScreen() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Plan | null>(null);
  const [retiring, setRetiring] = useState<Plan | null>(null);
  const [showing, setShowing] = useState<Plan | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);
  // What is sold is an owner's decision. A support account reaching this screen by its address
  // reads the shelf and changes nothing on it.
  const { can } = usePermissions();
  const mayWrite = can('plan:write');

  const plans = useQuery({
    queryKey: qk.plans(includeArchived),
    queryFn: async () =>
      (await http.list<Plan>('/api/v1/plans', includeArchived ? { includeArchived: 'true' } : {}))
        .data,
  });

  /**
   * Retiring a plan is the answer to "we do not sell this any more" that does not require moving
   * everybody off it first. Deleting still refuses while anybody is on it, and always will.
   */
  const retire = useMutation({
    mutationFn: (plan: Plan) =>
      http.patch<Plan>(`/api/v1/plans/${plan.id}`, { isArchived: !plan.isArchived }),
    onSuccess: async (_data, plan) => {
      await queryClient.invalidateQueries({ queryKey: ['plans'] });
      toast({
        tone: 'success',
        title: plan.isArchived ? 'Back on the shelf' : 'Retired',
        description: plan.isArchived
          ? 'It can be sold again.'
          : 'Customers already on it are untouched; it is simply not offered to anybody new.',
      });
    },
    onError: (error: Error) => {
      toast({ tone: 'danger', title: 'Could not change that plan', description: error.message });
    },
  });

  const remove = useMutation({
    mutationFn: (plan: Plan) => http.del(`/api/v1/plans/${plan.id}`),
    onSuccess: async () => {
      // The prefix, not one list: retired and current are separate cached lists now, and a plan
      // deleted while retired ones are shown must leave both.
      await queryClient.invalidateQueries({ queryKey: ['plans'] });
      toast({ tone: 'success', title: 'Plan deleted' });
    },
    onError: (error: Error) => {
      toast({ tone: 'danger', title: 'Could not delete that plan', description: error.message });
    },
  });

  const allColumns: Column<Plan>[] = [
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
            {plan.isArchived && <Badge tone="neutral">Retired</Badge>}
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
      key: 'price',
      header: 'Price',
      cell: (plan) => <span className="tnum">{money(plan.priceMonthlyMinor, plan.currency)}</span>,
    },
    {
      key: 'customers',
      header: 'Customers',
      cell: (plan) =>
        plan.customers === 0 ? (
          <span className="text-sm text-muted">None</span>
        ) : (
          <button
            type="button"
            className="tnum text-flare-link underline underline-offset-2"
            onClick={() => {
              setShowing(plan);
            }}
          >
            {plan.customers}
          </button>
        ),
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
            icon={plan.isArchived ? ArchiveRestore : Archive}
            loading={retire.isPending && retire.variables.id === plan.id}
            onClick={() => {
              setRetiring(plan);
            }}
          >
            {plan.isArchived ? 'Restore' : 'Retire'}
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
  const columns = allColumns.filter((column) => column.key !== 'actions' || mayWrite);

  return (
    <>
      <PageHeader
        title="Plans"
        description="What a customer gets by default. Anything specific to one customer is an override on their own screen."
        actions={
          <>
            <Checkbox
              checked={includeArchived}
              label="Show retired"
              onChange={setIncludeArchived}
            />
            {mayWrite && (
              <Button
                variant="primary"
                icon={Plus}
                onClick={() => {
                  setEditing('new');
                }}
              >
                New plan
              </Button>
            )}
          </>
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
              mayWrite ? (
                <Button
                  variant="primary"
                  icon={Plus}
                  onClick={() => {
                    setEditing('new');
                  }}
                >
                  New plan
                </Button>
              ) : undefined
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

      <PlanCustomers
        plan={showing}
        onClose={() => {
          setShowing(null);
        }}
      />

      <ConfirmDialog
        open={retiring !== null}
        onOpenChange={(v) => {
          if (!v) setRetiring(null);
        }}
        title={
          retiring?.isArchived === true
            ? `Sell ${retiring.name} again?`
            : `Retire ${retiring?.name ?? 'this plan'}?`
        }
        description={
          retiring?.isArchived === true
            ? 'It goes back on the shelf and can be chosen for a customer again.'
            : 'It stops being offered to anybody new. Every customer already on it stays on it, on exactly the terms they have.'
        }
        consequences={
          retiring?.isArchived === true
            ? []
            : [
                `${String(retiring?.customers ?? 0)} customer${retiring?.customers === 1 ? '' : 's'} stay on it, unchanged`,
                'It disappears from this list unless you ask for retired ones',
              ]
        }
        confirmLabel={retiring?.isArchived === true ? 'Sell it again' : 'Retire'}
        tone="primary"
        loading={retire.isPending}
        onConfirm={() => {
          if (retiring !== null) retire.mutate(retiring);
          setRetiring(null);
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

/**
 * Who is on this plan, and what each of them actually pays.
 *
 * The count in the table is the question; this is the answer, and it is also what makes retiring a
 * plan a decision somebody can take rather than guess at.
 */
function PlanCustomers({ plan, onClose }: { plan: Plan | null; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const customers = useQuery({
    queryKey: qk.planCustomers(plan?.id ?? '', page),
    enabled: plan !== null,
    queryFn: () =>
      http.list<PlanCustomer>(`/api/v1/plans/${plan?.id ?? ''}/customers`, {
        page,
        pageSize: PLAN_CUSTOMERS_PER_PAGE,
      }),
  });

  if (plan === null) return null;

  const columns: Column<PlanCustomer>[] = [
    {
      key: 'name',
      header: 'Customer',
      cell: (row) => (
        <Link
          to="/customers/$customerId"
          params={{ customerId: row.customerId }}
          className="no-underline hover:underline"
        >
          {row.name}
        </Link>
      ),
    },
    {
      key: 'pays',
      header: 'Pays',
      cell: (row) => (
        <span className="flex items-center gap-2">
          <span className="tnum">{money(row.chargedPriceMonthlyMinor, plan.currency)}</span>
          {row.priceState !== 'full' && <Badge tone="neutral">{PRICE_STATE[row.priceState]}</Badge>}
        </span>
      ),
    },
    {
      key: 'renews',
      header: 'Renews',
      cell: (row) => <span className="text-sm text-muted">{row.renewsOn ?? '—'}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => <span className="text-base">{row.status}</span>,
    },
  ];

  return (
    <Sheet
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      title={`On ${plan.name}`}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <StateSlot
        isPending={customers.isPending}
        error={customers.error}
        isEmpty={customers.data?.data.length === 0}
        empty={<EmptyState title="Nobody is on this plan" />}
      >
        <div className="rounded-md border border-border bg-surface">
          <Table
            caption={`Customers on ${plan.name}`}
            columns={columns}
            rows={customers.data?.data ?? []}
            rowKey={(row) => row.customerId}
          />
        </div>
        <div className="mt-3">
          <Pager
            page={page}
            pageSize={PLAN_CUSTOMERS_PER_PAGE}
            total={customers.data?.page.total ?? 0}
            onChange={setPage}
            noun="customers"
          />
        </div>
      </StateSlot>
    </Sheet>
  );
}

const PLAN_CUSTOMERS_PER_PAGE = 25;

const PRICE_STATE: Record<PlanCustomer['priceState'], string> = {
  trial: 'On trial',
  discounted: 'Discounted',
  expired: 'Expired',
  full: 'Full price',
};

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
  const [currency, setCurrency] = useState(isNew ? 'KES' : plan.currency);
  // Held as what a person types, in whole currency, and converted on the way out. Keeping minor
  // units in the field would make "1500" mean fifteen shillings to everyone except the database.
  const [price, setPrice] = useState(() =>
    isNew ? '' : fromMinor(plan.priceMonthlyMinor, plan.currency),
  );
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
        priceMonthlyMinor: toMinor(price, currency),
        currency,
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

  const currencyError = isCurrency(currency)
    ? undefined
    : 'Not a currency code. Three letters, like KES.';
  const priceError =
    price.trim() === '' || toMinor(price, currency) !== null
      ? undefined
      : 'A price is a number, and it cannot be negative.';

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
            disabled={name.trim() === '' || currencyError !== undefined || priceError !== undefined}
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
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
          <Input
            label="Price a month"
            description={
              priceError === undefined && price.trim() !== ''
                ? `Stored as ${String(toMinor(price, currency) ?? 0)} minor units, and shown as ${money(toMinor(price, currency), currency)}.`
                : 'Leave it empty for a plan that is not sold, such as an internal one.'
            }
            placeholder="1500.00"
            inputMode="decimal"
            error={priceError}
            value={price}
            onChange={(e) => {
              setPrice(e.target.value);
            }}
          />
          <Input
            label="Currency"
            mono
            maxLength={3}
            error={currencyError}
            value={currency}
            onChange={(e) => {
              setCurrency(e.target.value.toUpperCase());
            }}
          />
        </div>

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
