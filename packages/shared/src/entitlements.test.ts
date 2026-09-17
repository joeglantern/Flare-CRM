import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ENTITLEMENTS,
  FEATURES,
  INHERITED_FEATURES,
  daysUntilExpiry,
  entitlementsDocument,
  featureKeys,
  fillInheritedFeatures,
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

/**
 * The case that matters here is the one already in the field: a document signed by a console that
 * had never heard of a feature, arriving at a stack that has.
 */
describe('fillInheritedFeatures', () => {
  const older = () => {
    const features: Record<string, boolean> = { ...DEFAULT_ENTITLEMENTS.features };
    delete features.dialpad;
    return { ...DEFAULT_ENTITLEMENTS, features };
  };

  it('is what makes an older document readable at all', () => {
    expect(entitlementsDocument.safeParse(older()).success).toBe(false);
    expect(entitlementsDocument.safeParse(fillInheritedFeatures(older())).success).toBe(true);
  });

  it('gives a split-out feature whatever it was part of', () => {
    const on = entitlementsDocument.parse(fillInheritedFeatures(older()));
    expect(on.features.dialpad).toBe(true);

    const doc = older();
    doc.features.telephony = false;
    const off = entitlementsDocument.parse(fillInheritedFeatures(doc));
    expect(off.features.dialpad).toBe(false);
  });

  it('never overrides a value the document already carries', () => {
    const doc = { ...DEFAULT_ENTITLEMENTS, features: { ...DEFAULT_ENTITLEMENTS.features } };
    doc.features.dialpad = false;
    expect(entitlementsDocument.parse(fillInheritedFeatures(doc)).features.dialpad).toBe(false);
  });

  it('hands back anything that is not a document untouched, for the schema to refuse', () => {
    expect(fillInheritedFeatures(null)).toBeNull();
    expect(fillInheritedFeatures('nope')).toBe('nope');
    expect(fillInheritedFeatures({ features: 7 })).toEqual({ features: 7 });
  });

  it('only inherits from features that exist', () => {
    for (const from of Object.values(INHERITED_FEATURES)) expect(featureKeys).toContain(from);
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
