/**
 * Settings, Your plan (docs/20 §5).
 *
 * What this workspace is entitled to, what it is using, and who to contact to change it. Read
 * only by design: a customer's admin cannot grant themselves a feature, and pretending otherwise
 * with a disabled switch would be worse than not showing one.
 */
import { FEATURES, LIMITS, featureKeys, limitKeys, type LimitKey } from '@crm/shared';
import { CircleCheck, CircleMinus, RefreshCw } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/toast';
import { DateTime } from '@/components/data/formatters';
import { Panel } from '@/components/entity/EntityHeader';
import { api, unwrap } from '@/lib/api/client';
import { errorMessage } from '@/lib/api/errors';
import { formatBytes } from '@/lib/api/attachments';
import { qk } from '@/lib/query';
import { useEntitlements } from '@/providers/entitlements';
import { usePermissions } from '@/providers/permissions';
import { cn } from '@/lib/utils';

const SOURCE_NOTE: Record<string, string> = {
  console: 'Managed by your provider. Changes arrive here automatically.',
  file: 'Loaded from a signed file on this server.',
  default: 'No plan is being enforced: every feature is on and nothing is capped.',
};

export function PlanSection() {
  const e = useEntitlements();
  const perms = usePermissions();
  const qc = useQueryClient();

  const reload = useMutation({
    mutationFn: async () => unwrap(await api.POST('/api/v1/entitlements/reload')).data,
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: qk.entitlements() });
      toast(
        data.result === 'applied'
          ? { tone: 'success', title: 'Plan reloaded from the file' }
          : {
              tone: 'warning',
              title: 'The file was not applied',
              description: data.reason ?? 'It was refused.',
            },
      );
    },
    onError: (err) => {
      toast({ tone: 'danger', title: 'Could not reload the plan', description: errorMessage(err) });
    },
  });

  const status = e.expired
    ? { tone: 'danger' as const, label: 'Expired' }
    : e.expiresInDays !== null && e.expiresInDays <= 14
      ? { tone: 'warning' as const, label: `Ends in ${String(e.expiresInDays)} days` }
      : { tone: 'success' as const, label: 'Active' };

  return (
    <>
      <Panel title="Your plan">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-lg font-medium">{e.plan.name}</span>
              <Badge tone={status.tone}>{status.label}</Badge>
            </div>
            <p className="mt-1 text-base text-muted">
              {e.customerName}
              {e.expiresAt !== null && (
                <>
                  {' · '}
                  {e.expired ? 'ended' : 'ends'} <DateTime value={e.expiresAt} />
                </>
              )}
            </p>
            <p className="mt-2 text-sm text-faint">{SOURCE_NOTE[e.source]}</p>
          </div>
          {e.source === 'file' && perms.has('settings:manage') && (
            <Button
              variant="secondary"
              size="sm"
              icon={RefreshCw}
              loading={reload.isPending}
              onClick={() => {
                reload.mutate();
              }}
            >
              Reload from file
            </Button>
          )}
        </div>
        {e.expired && (
          <p className="mt-3 rounded-md bg-[var(--danger-subtle)] p-3 text-base">
            The CRM is read only until the plan is renewed. Nothing has been deleted and every
            record is still here.
          </p>
        )}
      </Panel>

      <Panel title="What is included" padded={false}>
        <ul>
          {featureKeys.map((key) => {
            const on = e.features[key];
            return (
              <li
                key={key}
                className="flex items-start gap-3 border-b border-border px-3.5 py-2.5 last:border-b-0"
              >
                {on ? (
                  <CircleCheck size={15} className="mt-0.5 shrink-0 text-success" aria-hidden />
                ) : (
                  <CircleMinus size={15} className="mt-0.5 shrink-0 text-faint" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <div className={cn('text-base', on ? '' : 'text-muted')}>
                    {FEATURES[key].label}
                  </div>
                  <p className="text-sm text-muted">{FEATURES[key].description}</p>
                </div>
                <span className={cn('shrink-0 text-sm', on ? 'text-success' : 'text-faint')}>
                  {on ? 'Included' : 'Not included'}
                </span>
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel title="Limits" note="Usage is counted live, except storage, which is checked nightly.">
        <div className="flex flex-col gap-3.5">
          {limitKeys.map((key) => (
            <LimitRow key={key} limitKey={key} />
          ))}
        </div>
      </Panel>

      <Panel title="Who to contact">
        <div className="text-base">
          <div>{e.ownerContact.name}</div>
          <a href={`mailto:${e.ownerContact.email}`}>{e.ownerContact.email}</a>
          {e.ownerContact.phone !== undefined && (
            <>
              {' · '}
              <a href={`tel:${e.ownerContact.phone}`}>{e.ownerContact.phone}</a>
            </>
          )}
        </div>
        {e.link.configured && (
          <p className="mt-3 text-sm text-muted">
            Plan updates {e.link.connected ? 'are arriving' : 'are not arriving right now'}
            {e.link.lastHeartbeatAt !== null && (
              <>
                {' · last contact '}
                <DateTime value={e.link.lastHeartbeatAt} mode="relative" />
              </>
            )}
            {e.receivedAt !== null && (
              <>
                {' · this plan arrived '}
                <DateTime value={e.receivedAt} mode="relative" />
              </>
            )}
            .
          </p>
        )}
      </Panel>
    </>
  );
}

function LimitRow({ limitKey }: { limitKey: LimitKey }) {
  const e = useEntitlements();
  const def = LIMITS[limitKey];
  const { used, max, label } = describe(limitKey, e);

  if (max === null) {
    return (
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="text-base">{def.label}</div>
          <p className="text-sm text-muted">{def.description}</p>
        </div>
        <span className="shrink-0 text-base text-muted">{label}</span>
      </div>
    );
  }
  const ratio = max === 0 ? 1 : Math.min(1, used / max);
  const tone = ratio >= 1 ? 'bg-danger' : ratio >= 0.85 ? 'bg-warning' : 'bg-flare';
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="text-base">{def.label}</div>
          <p className="text-sm text-muted">{def.description}</p>
        </div>
        <span className="tnum shrink-0 text-base">{label}</span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-hover"
        role="progressbar"
        aria-label={def.label}
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={max}
      >
        <div
          className={cn('h-full rounded-full', tone)}
          style={{ width: `${String(ratio * 100)}%` }}
        />
      </div>
    </div>
  );
}

function describe(
  key: LimitKey,
  e: ReturnType<typeof useEntitlements>,
): { used: number; max: number | null; label: string } {
  const none = 'No limit';
  switch (key) {
    case 'seats': {
      const { used, max } = e.usage.seats;
      return {
        used,
        max,
        label: max === null ? `${String(used)} · ${none}` : `${String(used)} of ${String(max)}`,
      };
    }
    case 'storage_gb': {
      const { usedBytes, maxBytes } = e.usage.storage;
      return {
        used: usedBytes,
        max: maxBytes,
        label:
          maxBytes === null
            ? `${formatBytes(usedBytes)} · ${none}`
            : `${formatBytes(usedBytes)} of ${formatBytes(maxBytes)}`,
      };
    }
    case 'recording_retention_days': {
      const r = e.usage.recordingRetentionDays;
      return {
        used: r.effective,
        max: r.max,
        label:
          r.max === null
            ? `${String(r.configured)} days · ${none}`
            : `${String(r.effective)} days, capped at ${String(r.max)}`,
      };
    }
    case 'channels': {
      const { used, max } = e.usage.channels;
      return {
        used,
        max,
        label: max === null ? `${String(used)} · ${none}` : `${String(used)} of ${String(max)}`,
      };
    }
    case 'pipelines': {
      const { used, max } = e.usage.pipelines;
      return {
        used,
        max,
        label: max === null ? `${String(used)} · ${none}` : `${String(used)} of ${String(max)}`,
      };
    }
  }
}
