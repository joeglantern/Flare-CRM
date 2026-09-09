/**
 * A throwaway console signing key for tests: the stack's verifier only trusts what this signs.
 */
import { createPublicKey, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { DEFAULT_ENTITLEMENTS, type EntitlementsDocument, type SignedEnvelope } from '@crm/shared';
import { keyIdOf, signDocument } from '../../src/modules/entitlements/signature.js';

export interface TestSigner {
  privateKey: KeyObject;
  /** Base64 SPKI DER, the value CONSOLE_PUBLIC_KEY takes. */
  publicKeyBase64: string;
  keyId: string;
  sign: (doc: EntitlementsDocument) => SignedEnvelope;
  /** A complete document with overrides applied; issuedAt defaults to now. */
  document: (overrides?: DocumentOverrides) => EntitlementsDocument;
}

export interface DocumentOverrides {
  features?: Partial<EntitlementsDocument['features']>;
  limits?: Partial<EntitlementsDocument['limits']>;
  expiresAt?: string | null;
  issuedAt?: string;
  audience?: string;
  plan?: EntitlementsDocument['plan'];
  customerName?: string;
}

export function createSigner(): TestSigner {
  const { privateKey } = generateKeyPairSync('ed25519');
  const spki = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  return {
    privateKey,
    publicKeyBase64: spki.toString('base64'),
    keyId: keyIdOf(spki),
    sign: (doc) => signDocument(doc, privateKey),
    document: (o = {}) => ({
      ...DEFAULT_ENTITLEMENTS,
      customerId: 'cus_test',
      customerName: o.customerName ?? 'Test Customer Ltd',
      plan: o.plan ?? { id: 'plan_test', name: 'Test plan' },
      features: { ...DEFAULT_ENTITLEMENTS.features, ...(o.features ?? {}) },
      limits: { ...DEFAULT_ENTITLEMENTS.limits, ...(o.limits ?? {}) },
      expiresAt: o.expiresAt === undefined ? null : o.expiresAt,
      issuedAt: o.issuedAt ?? new Date().toISOString(),
      issuer: 'https://console.test',
      ...(o.audience !== undefined ? { audience: o.audience } : {}),
      ownerContact: { name: 'Owner', email: 'owner@example.com', phone: '+254700000000' },
    }),
  };
}

export const TEST_STACK_ID = 'stk_abcdefghijklmnopqrst';
export const TEST_STACK_SECRET = 'test-stack-secret-test-stack-secret-0000';

/** Env overrides that make a TestContext trust `signer` and identify as TEST_STACK_ID. */
export function consoleEnv(signer: TestSigner): Record<string, string> {
  return {
    CONSOLE_URL: 'http://127.0.0.1:1',
    CONSOLE_STACK_ID: TEST_STACK_ID,
    CONSOLE_STACK_SECRET: TEST_STACK_SECRET,
    CONSOLE_PUBLIC_KEY: signer.publicKeyBase64,
  };
}

export function issueId(): string {
  return `iss_${crypto.randomUUID()}`;
}
