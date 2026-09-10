/**
 * The rules the entitlements editor follows, kept apart from the screen that draws it so they can
 * be read and tested on their own.
 *
 * An override only exists where the owner wants something other than the plan. Setting a switch
 * back to what the plan says removes the override rather than pinning the same value twice: a later
 * change to the plan should then carry to this customer, which is the whole reason plans exist.
 */
import {
  DEFAULT_ENTITLEMENTS,
  FEATURES,
  featureKeys,
  limitKeys,
  normaliseFeatures,
  type FeatureKey,
  type FeatureMap,
  type LimitKey,
  type LimitMap,
} from '@crm/shared';
import { fromMinor, toMinor } from '@/lib/format';
import type { CustomerEntitlements, Plan } from '@/lib/types';

export interface EditorState {
  planId: string | null;
  featureOverrides: Partial<Record<FeatureKey, boolean>>;
  limitOverrides: Partial<Record<LimitKey, number | null>>;
  /** `yyyy-MM-dd` as a date input gives it, or empty for no expiry. */
  expiryDay: string;
  /**
   * What this customer pays, as a person types it in whole currency, or empty to pay whatever the
   * plan charges. Held as text so an empty field stays "no override" rather than becoming zero.
   */
  priceMajor: string;
  agreementNotes: string;
}

export function planFeatures(plan: Plan | undefined): FeatureMap {
  return plan === undefined ? DEFAULT_ENTITLEMENTS.features : plan.features;
}

export function planLimits(plan: Plan | undefined): LimitMap {
  return plan === undefined ? DEFAULT_ENTITLEMENTS.limits : plan.limits;
}

/** What the customer would actually get if this state were saved and issued. */
export function effectiveFeatures(
  plan: Plan | undefined,
  overrides: Partial<Record<FeatureKey, boolean>>,
): FeatureMap {
  return normaliseFeatures({ ...planFeatures(plan), ...overrides });
}

export function effectiveLimits(
  plan: Plan | undefined,
  overrides: Partial<Record<LimitKey, number | null>>,
): LimitMap {
  return { ...planLimits(plan), ...overrides };
}

/** The prerequisites of a feature that are off, which is why it cannot be on either. */
export function blockedBy(key: FeatureKey, features: FeatureMap): FeatureKey[] {
  return FEATURES[key].requires.filter((r) => !features[r]);
}

/** Features that would be switched off with this one, because they depend on it. */
export function dependents(key: FeatureKey): FeatureKey[] {
  return featureKeys.filter((k) => FEATURES[k].requires.includes(key));
}

/** A copy without one key: an override that matches the plan should leave no trace behind. */
function without<K extends string, V>(map: Partial<Record<K, V>>, key: K): Partial<Record<K, V>> {
  return Object.fromEntries(Object.entries(map).filter(([k]) => k !== key)) as Partial<
    Record<K, V>
  >;
}

export function setFeature(
  state: EditorState,
  plan: Plan | undefined,
  key: FeatureKey,
  next: boolean,
): EditorState {
  const fromPlan = planFeatures(plan)[key];
  const featureOverrides = without(state.featureOverrides, key);
  if (next !== fromPlan) featureOverrides[key] = next;
  return { ...state, featureOverrides };
}

export function setLimit(
  state: EditorState,
  plan: Plan | undefined,
  key: LimitKey,
  next: number | null,
): EditorState {
  const fromPlan = planLimits(plan)[key];
  const limitOverrides = without(state.limitOverrides, key);
  if (next !== fromPlan) limitOverrides[key] = next;
  return { ...state, limitOverrides };
}

export function fromServer(entitlements: CustomerEntitlements): EditorState {
  return {
    planId: entitlements.planId,
    featureOverrides: { ...entitlements.featureOverrides },
    limitOverrides: { ...entitlements.limitOverrides },
    expiryDay: entitlements.expiresAt === null ? '' : entitlements.expiresAt.slice(0, 10),
    priceMajor: fromMinor(entitlements.priceMonthlyMinorOverride, entitlements.effective.currency),
    agreementNotes: entitlements.agreementNotes,
  };
}

export interface SavePayload {
  planId: string | null;
  featureOverrides: Partial<Record<FeatureKey, boolean>>;
  limitOverrides: Partial<Record<LimitKey, number | null>>;
  expiresAt: string | null;
  /** Minor units, never a float, and null to charge whatever the plan charges. */
  priceMonthlyMinorOverride: number | null;
  agreementNotes: string;
}

/**
 * The body the console API expects. Expiry is sent as the end of the chosen day in this browser's
 * zone: a plan bought until the 30th should not stop working at midnight on the 29th.
 */
export function savePayload(state: EditorState, currency: string): SavePayload {
  const expiresAt =
    state.expiryDay === '' ? null : new Date(`${state.expiryDay}T23:59:59`).toISOString();
  return {
    planId: state.planId,
    featureOverrides: state.featureOverrides,
    limitOverrides: state.limitOverrides,
    expiresAt,
    priceMonthlyMinorOverride: toMinor(state.priceMajor, currency),
    agreementNotes: state.agreementNotes,
  };
}

export function isDirty(state: EditorState, saved: EditorState): boolean {
  return JSON.stringify(state) !== JSON.stringify(saved);
}

/** Overrides that no longer differ from the plan, so the editor can offer to tidy them away. */
export function redundantOverrides(state: EditorState, plan: Plan | undefined): FeatureKey[] {
  const base = planFeatures(plan);
  return featureKeys.filter((k) => state.featureOverrides[k] === base[k]);
}

export { featureKeys, limitKeys };
