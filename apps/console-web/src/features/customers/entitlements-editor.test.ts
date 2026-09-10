import { DEFAULT_ENTITLEMENTS } from '@crm/shared';
import { describe, expect, it } from 'vitest';
import type { Plan } from '@/lib/types';
import {
  blockedBy,
  dependents,
  effectiveFeatures,
  effectiveLimits,
  fromServer,
  isDirty,
  savePayload,
  setFeature,
  setLimit,
  type EditorState,
} from './entitlements-editor';

const plan: Plan = {
  id: 'plan-1',
  name: 'Standard',
  description: '',
  features: { ...DEFAULT_ENTITLEMENTS.features, softphone: false, api_docs: false },
  limits: { ...DEFAULT_ENTITLEMENTS.limits, seats: 10, storage_gb: 20 },
  isDefault: true,
};

const empty: EditorState = {
  planId: plan.id,
  featureOverrides: {},
  limitOverrides: {},
  expiryDay: '',
  agreementNotes: '',
};

describe('the entitlements editor rules', () => {
  it('starts from the plan when nothing is overridden', () => {
    const features = effectiveFeatures(plan, {});
    expect(features.telephony).toBe(true);
    expect(features.softphone).toBe(false);
    expect(effectiveLimits(plan, {}).seats).toBe(10);
  });

  it('takes the dependants of a feature down with it', () => {
    const features = effectiveFeatures(plan, { telephony: false });
    expect(features.telephony).toBe(false);
    expect(features.recordings).toBe(false);
    expect(blockedBy('recordings', features)).toEqual(['telephony']);
    expect(dependents('telephony')).toEqual(['recordings', 'softphone']);
  });

  it('cannot switch a feature on while its prerequisite is off', () => {
    const state = setFeature(empty, plan, 'telephony', false);
    // The plan grants recordings and nothing overrides that,
    expect(state.featureOverrides).toEqual({ telephony: false });
    // yet with telephony off it is off, which is how the server computes it too.
    expect(effectiveFeatures(plan, state.featureOverrides).recordings).toBe(false);
    // Asking for it explicitly changes nothing while the prerequisite is off.
    const asked = setFeature(state, plan, 'recordings', true);
    expect(effectiveFeatures(plan, asked.featureOverrides).recordings).toBe(false);
  });

  it('records an override only where it differs from the plan', () => {
    const off = setFeature(empty, plan, 'exports', false);
    expect(off.featureOverrides).toEqual({ exports: false });

    // Setting it back to what the plan says drops the override rather than pinning the same value:
    // a later change to the plan should then reach this customer.
    const back = setFeature(off, plan, 'exports', true);
    expect(back.featureOverrides).toEqual({});

    // And a value the plan already gives is never written down.
    expect(setFeature(empty, plan, 'softphone', false).featureOverrides).toEqual({});
  });

  it('treats a limit the same way, including no limit at all', () => {
    const capped = setLimit(empty, plan, 'seats', 3);
    expect(capped.limitOverrides).toEqual({ seats: 3 });
    expect(effectiveLimits(plan, capped.limitOverrides).seats).toBe(3);

    const uncapped = setLimit(capped, plan, 'seats', null);
    expect(uncapped.limitOverrides).toEqual({ seats: null });
    expect(effectiveLimits(plan, uncapped.limitOverrides).seats).toBeNull();

    expect(setLimit(capped, plan, 'seats', 10).limitOverrides).toEqual({});
  });

  it('sends the body the console API expects', () => {
    const state: EditorState = {
      planId: plan.id,
      featureOverrides: { telephony: false },
      limitOverrides: { seats: 3 },
      expiryDay: '2026-12-31',
      agreementNotes: 'Two year deal, invoiced yearly.',
    };
    const payload = savePayload(state);
    expect(payload.planId).toBe(plan.id);
    expect(payload.featureOverrides).toEqual({ telephony: false });
    expect(payload.limitOverrides).toEqual({ seats: 3 });
    expect(payload.agreementNotes).toBe('Two year deal, invoiced yearly.');
    // The end of the chosen day, not its start: a plan bought until the 31st works on the 31st.
    expect(payload.expiresAt).not.toBeNull();
    const expiry = new Date(payload.expiresAt ?? '');
    expect(expiry.getFullYear()).toBe(2026);
    expect(expiry.getHours()).toBe(23);
  });

  it('sends no expiry as null rather than as an empty string', () => {
    expect(savePayload(empty).expiresAt).toBeNull();
  });

  it('reads what the server stored without changing it', () => {
    const state = fromServer({
      planId: plan.id,
      featureOverrides: { exports: false },
      limitOverrides: { seats: 5 },
      expiresAt: '2026-12-31T23:59:59.000Z',
      agreementNotes: 'notes',
      effective: {
        plan: { id: plan.id, name: plan.name },
        features: plan.features,
        limits: plan.limits,
        expiresAt: '2026-12-31T23:59:59.000Z',
      },
    });
    expect(state.expiryDay).toBe('2026-12-31');
    expect(isDirty(state, state)).toBe(false);
    expect(isDirty(setFeature(state, plan, 'imports', false), state)).toBe(true);
  });
});
