import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ENTITLEMENTS,
  FEATURES,
  daysUntilExpiry,
  entitlementsDocument,
  featureKeys,
  isExpired,
  limitKeys,
  normaliseFeatures,
  signedEnvelope,
} from './entitlements.js';

describe('DEFAULT_ENTITLEMENTS', () => {
  it('turns every feature on with no limits, so a standalone install changes nothing', () => {
    for (const k of featureKeys) expect(DEFAULT_ENTITLEMENTS.features[k]).toBe(true);
    for (const k of limitKeys) expect(DEFAULT_ENTITLEMENTS.limits[k]).toBeNull();
    expect(DEFAULT_ENTITLEMENTS.expiresAt).toBeNull();
    expect(entitlementsDocument.safeParse(DEFAULT_ENTITLEMENTS).success).toBe(true);
  });
  it('only ever requires features that exist', () => {
    for (const k of featureKeys)
      for (const r of FEATURES[k].requires) expect(featureKeys).toContain(r);
  });
});

describe('normaliseFeatures', () => {
  it('switches off anything whose prerequisite is off', () => {
    const out = normaliseFeatures({ ...DEFAULT_ENTITLEMENTS.features, telephony: false });
    expect(out.telephony).toBe(false);
    expect(out.recordings).toBe(false);
    expect(out.softphone).toBe(false);
    expect(out.messaging).toBe(true);
  });
  it('leaves a coherent set untouched', () => {
    expect(normaliseFeatures(DEFAULT_ENTITLEMENTS.features)).toEqual(DEFAULT_ENTITLEMENTS.features);
  });
});

describe('entitlementsDocument', () => {
  it('rejects unknown feature keys and extra top-level keys', () => {
    const withExtraFeature = {
      ...DEFAULT_ENTITLEMENTS,
      features: { ...DEFAULT_ENTITLEMENTS.features, teleportation: true },
    };
    expect(entitlementsDocument.safeParse(withExtraFeature).success).toBe(false);
    expect(entitlementsDocument.safeParse({ ...DEFAULT_ENTITLEMENTS, extra: 1 }).success).toBe(
      false,
    );
  });
  it('rejects negative limits', () => {
    const doc = { ...DEFAULT_ENTITLEMENTS, limits: { ...DEFAULT_ENTITLEMENTS.limits, seats: -1 } };
    expect(entitlementsDocument.safeParse(doc).success).toBe(false);
  });
});

describe('signedEnvelope', () => {
  const ok = { payload: 'eyJhIjoxfQ', signature: 'A'.repeat(86), keyId: '0123456789abcdef' };
  it('accepts a well-formed envelope', () => {
    expect(signedEnvelope.safeParse(ok).success).toBe(true);
  });
  it('rejects padded base64, a wrong-length signature and a bad key id', () => {
    expect(signedEnvelope.safeParse({ ...ok, payload: 'eyJhIjoxfQ==' }).success).toBe(false);
    expect(signedEnvelope.safeParse({ ...ok, signature: 'A'.repeat(85) }).success).toBe(false);
    expect(signedEnvelope.safeParse({ ...ok, keyId: 'nothex' }).success).toBe(false);
  });
});

describe('expiry', () => {
  const now = new Date('2026-09-10T12:00:00.000Z');
  it('never expires without a date', () => {
    expect(isExpired({ expiresAt: null }, now)).toBe(false);
    expect(daysUntilExpiry({ expiresAt: null }, now)).toBeNull();
  });
  it('expires at the instant given and counts whole days until then', () => {
    expect(isExpired({ expiresAt: '2026-09-10T12:00:00.000Z' }, now)).toBe(true);
    expect(isExpired({ expiresAt: '2026-09-10T12:00:01.000Z' }, now)).toBe(false);
    expect(daysUntilExpiry({ expiresAt: '2026-09-24T12:00:00.000Z' }, now)).toBe(14);
    expect(daysUntilExpiry({ expiresAt: '2026-09-01T12:00:00.000Z' }, now)).toBe(-9);
  });
});
