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
  /** `yyyy-MM-dd`, or empty. A trial pays nothing until this day and the full price after it. */
  trialDay: string;
  /** `yyyy-MM-dd`, or empty. The day the agreement comes round again. */
  renewsOnDay: string;
  /** Whole percent off the list price, as typed. Empty means no discount at all. */
  discountPercent: string;
  discountUntilDay: string;
  discountNote: string;
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
    trialDay: entitlements.trialEndsAt === null ? '' : entitlements.trialEndsAt.slice(0, 10),
    renewsOnDay: entitlements.renewsOn === null ? '' : entitlements.renewsOn.slice(0, 10),
    discountPercent:
      entitlements.discountPercent === null ? '' : String(entitlements.discountPercent),
    discountUntilDay:
      entitlements.discountUntil === null ? '' : entitlements.discountUntil.slice(0, 10),
    discountNote: entitlements.discountNote,
  };
}

/** A whole percent between nothing and everything, or null when the field is empty or nonsense. */
export function parsePercent(typed: string): number | null {
  const trimmed = typed.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  const whole = Math.round(value);
  if (whole <= 0 || whole > 100) return null;
  return whole;
}

export interface SavePayload {
  planId: string | null;
  featureOverrides: Partial<Record<FeatureKey, boolean>>;
  limitOverrides: Partial<Record<LimitKey, number | null>>;
  expiresAt: string | null;
  /** Minor units, never a float, and null to charge whatever the plan charges. */
  priceMonthlyMinorOverride: number | null;
  agreementNotes: string;
  trialEndsAt: string | null;
  renewsOn: string | null;
  discountPercent: number | null;
  discountUntil: string | null;
  discountNote: string;
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
    // A trial and a discount both end at the end of their day, for the same reason an expiry does.
    trialEndsAt:
      state.trialDay === '' ? null : new Date(`${state.trialDay}T23:59:59`).toISOString(),
    renewsOn: state.renewsOnDay === '' ? null : state.renewsOnDay,
    discountPercent: parsePercent(state.discountPercent),
    discountUntil:
      state.discountUntilDay === ''
        ? null
        : new Date(`${state.discountUntilDay}T23:59:59`).toISOString(),
    discountNote: state.discountNote.trim(),
  };
}

/**
 * What this customer would actually pay if the editor were saved as it stands.
 *
 * The same order the server applies, so the sentence under the price field and the figure the
 * dashboard adds up can never disagree: an expiry beats a trial, a trial beats a discount, and
 * anything else pays the list price.
 */
export function previewCharge(
  state: EditorState,
  plan: Plan | undefined,
  currency: string,
  now = new Date(),
): { listMinor: number; chargedMinor: number; state: 'trial' | 'discounted' | 'expired' | 'full' } {
  const listMinor = toMinor(state.priceMajor, currency) ?? plan?.priceMonthlyMinor ?? 0;
  const endOf = (day: string) => (day === '' ? null : new Date(`${day}T23:59:59`));

  const expiry = endOf(state.expiryDay);
  if (expiry !== null && expiry.getTime() <= now.getTime()) {
    return { listMinor, chargedMinor: 0, state: 'expired' };
  }
  const trial = endOf(state.trialDay);
  if (trial !== null && trial.getTime() > now.getTime()) {
    return { listMinor, chargedMinor: 0, state: 'trial' };
  }
  const percent = parsePercent(state.discountPercent);
  const until = endOf(state.discountUntilDay);
  if (percent !== null && (until === null || until.getTime() > now.getTime())) {
    return {
      listMinor,
      chargedMinor: Math.round((listMinor * (100 - percent)) / 100),
      state: 'discounted',
    };
  }
  return { listMinor, chargedMinor: listMinor, state: 'full' };
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
