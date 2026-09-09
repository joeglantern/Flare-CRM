/**
 * EntitlementsProvider / useFeature / useAccess (docs/20).
 *
 * What the customer's plan includes. The server enforces it; this is what lets the interface hide
 * a feature nobody bought instead of offering a button that returns 403. Until the first response
 * arrives every feature reads as on, so a screen never flashes locked for a plan that has it.
 *
 * A change made in the owner console arrives on the `entitlements:changed` socket event, so the
 * app updates without a reload.
 */
import {
  DEFAULT_ENTITLEMENTS,
  FEATURES,
  featureKeys,
  type EntitlementsDto,
  type FeatureKey,
  type Permission,
} from '@crm/shared';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react';
import { toast } from '@/components/ui/toast';
import { api, unwrap } from '@/lib/api/client';
import { qk } from '@/lib/query';
import { useSocketEvent } from '@/lib/socket/client';
import { usePermissions } from './permissions';

export const entitlementsQuery = queryOptions({
  queryKey: qk.entitlements(),
  queryFn: async (): Promise<EntitlementsDto> => unwrap(await api.GET('/api/v1/entitlements')).data,
  staleTime: 5 * 60_000,
  retry: false,
});

/** Everything on, no limits: what an unmanaged stack reports and what we assume while loading. */
const FALLBACK: EntitlementsDto = {
  customerName: DEFAULT_ENTITLEMENTS.customerName,
  plan: DEFAULT_ENTITLEMENTS.plan,
  features: DEFAULT_ENTITLEMENTS.features,
  limits: DEFAULT_ENTITLEMENTS.limits,
  usage: {
    seats: { used: 0, max: null },
    storage: {
      usedBytes: 0,
      maxBytes: null,
      breakdown: { attachments: 0, recordings: 0, backups: 0 },
      refreshedAt: null,
    },
    channels: { used: 0, max: null },
    pipelines: { used: 0, max: null },
    recordingRetentionDays: { configured: 0, max: null, effective: 0 },
  },
  expiresAt: null,
  expired: false,
  expiresInDays: null,
  ownerContact: DEFAULT_ENTITLEMENTS.ownerContact,
  source: 'default',
  receivedAt: null,
  issuedAt: null,
  issueId: null,
  keyId: null,
  link: { configured: false, connected: false, lastHeartbeatAt: null },
};

const EntitlementsContext = createContext<EntitlementsDto>(FALLBACK);

export function EntitlementsProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data } = useQuery(entitlementsQuery);
  const value = data ?? FALLBACK;

  // Announce what actually changed. The event carries the new features, so the comparison is
  // against what this browser was last showing rather than whatever arrives after the refetch.
  const previous = useRef<Record<string, boolean> | null>(data ? data.features : null);
  useEffect(() => {
    if (data) previous.current ??= data.features;
  }, [data]);

  useSocketEvent(
    'entitlements:changed',
    useCallback(
      (payload: { features: Record<string, boolean> }) => {
        void qc.invalidateQueries({ queryKey: qk.entitlements() });
        const before = previous.current;
        previous.current = payload.features;
        if (!before) return;
        const label = (k: FeatureKey) => FEATURES[k].label;
        const enabled = featureKeys.filter((k) => !before[k] && payload.features[k]).map(label);
        const disabled = featureKeys.filter((k) => before[k] && !payload.features[k]).map(label);
        if (enabled.length === 0 && disabled.length === 0) return;
        toast({
          key: 'plan-changed',
          tone: 'neutral',
          title: 'Your plan was updated',
          description: [
            enabled.length > 0 ? `Added: ${enabled.join(', ')}.` : '',
            disabled.length > 0 ? `Removed: ${disabled.join(', ')}.` : '',
          ]
            .filter(Boolean)
            .join(' '),
          duration: 8000,
        });
      },
      [qc],
    ),
  );

  return <EntitlementsContext value={value}>{children}</EntitlementsContext>;
}

export function useEntitlements(): EntitlementsDto {
  return useContext(EntitlementsContext);
}

export interface FeatureState {
  enabled: boolean;
  label: string;
  description: string;
}

export function useFeature(feature: FeatureKey): FeatureState {
  const entitlements = useEntitlements();
  return {
    enabled: entitlements.features[feature],
    label: FEATURES[feature].label,
    description: FEATURES[feature].description,
  };
}

export interface AccessState {
  allowed: boolean;
  /** Which check refused, so the screen can say the right thing. */
  blockedBy: 'permission' | 'feature' | null;
  permission?: Permission;
  feature?: FeatureKey;
}

/**
 * Permission first, then plan. Someone whose role could never use a screen is told about their
 * role; telling them to buy a feature they still could not use would be wrong.
 */
export function useAccess(permission?: Permission, feature?: FeatureKey): AccessState {
  const perms = usePermissions();
  const entitlements = useEntitlements();
  if (permission !== undefined && !perms.has(permission)) {
    return { allowed: false, blockedBy: 'permission', permission };
  }
  if (feature !== undefined && !entitlements.features[feature]) {
    return { allowed: false, blockedBy: 'feature', feature };
  }
  return { allowed: true, blockedBy: null };
}

export interface PlanState {
  expired: boolean;
  expiresInDays: number | null;
  /** Within a fortnight of the end, so screens can warn before anything stops working. */
  expiringSoon: boolean;
  ownerContact: EntitlementsDto['ownerContact'];
  customerName: string;
  planName: string;
}

export function usePlanState(): PlanState {
  const e = useEntitlements();
  return {
    expired: e.expired,
    expiresInDays: e.expiresInDays,
    expiringSoon: !e.expired && e.expiresInDays !== null && e.expiresInDays <= 14,
    ownerContact: e.ownerContact,
    customerName: e.customerName,
    planName: e.plan.name,
  };
}

/** Disables a create or save control while the plan is expired, with a reason for the tooltip. */
export function useWriteGuard(): { disabled: boolean; reason: string | undefined } {
  const { expired, ownerContact } = usePlanState();
  return expired
    ? {
        disabled: true,
        reason: `Your plan has expired, so changes are refused. Contact ${ownerContact.name} (${ownerContact.email}) to renew.`,
      }
    : { disabled: false, reason: undefined };
}
