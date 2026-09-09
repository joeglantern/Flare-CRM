/**
 * Wraps a screen whose whole point is a feature the plan may not include (docs/20).
 *
 * The nav item is already hidden, so this catches a bookmark, a shared link or the back button.
 * The server refuses these routes anyway; this is what turns that refusal into an explanation.
 */
import type { FeatureKey, Permission } from '@crm/shared';
import type { ReactNode } from 'react';
import { ForbiddenState, PlanLockedState } from '@/components/data/states';
import { useAccess, useEntitlements } from '@/providers/entitlements';
import { usePermissions } from '@/providers/permissions';

export function FeatureGate({
  feature,
  permission,
  what,
  children,
}: {
  feature: FeatureKey;
  /** Checked first: a role that could never use this is told about the role, not the plan. */
  permission?: Permission;
  what?: string;
  children: ReactNode;
}) {
  const access = useAccess(permission, feature);
  const { ownerContact } = useEntitlements();
  const perms = usePermissions();

  if (access.blockedBy === 'permission') {
    return (
      <div className="p-6">
        <ForbiddenState permission={access.permission} {...(what !== undefined ? { what } : {})} />
      </div>
    );
  }
  if (access.blockedBy === 'feature') {
    return (
      <div className="p-6">
        <PlanLockedState
          feature={feature}
          {...(what !== undefined ? { what } : {})}
          owner={ownerContact}
          showPlanLink={perms.has('settings:read')}
        />
      </div>
    );
  }
  return <>{children}</>;
}
