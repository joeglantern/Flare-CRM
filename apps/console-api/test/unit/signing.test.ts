/**
 * The console signs; a customer stack verifies. These are two services with two codebases, so the
 * agreement between them is checked here directly, using the stack's own verifier.
 */
import { generateKeyPairSync } from 'node:crypto';
import { DEFAULT_ENTITLEMENTS, type EntitlementsDocument } from '@crm/shared';
import { describe, expect, it } from 'vitest';
import {
  keyIdOf,
  parsePublicKey,
  verifyEnvelope,
} from '../../../api/src/modules/entitlements/signature.js';
import { createSigner } from '../../src/lib/signing.js';

function signerFor(): { signer: ReturnType<typeof createSigner>; privateKeyBase64: string } {
  const { privateKey } = generateKeyPairSync('ed25519');
  const privateKeyBase64 = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
  const signer = createSigner({ CONSOLE_SIGNING_KEY: privateKeyBase64 } as never);
  return { signer, privateKeyBase64 };
}

function document(over: Partial<EntitlementsDocument> = {}): EntitlementsDocument {
  return {
    version: 1,
    customerId: '11111111-1111-4111-8111-111111111111',
    customerName: 'Acme Ltd',
    plan: { id: '22222222-2222-4222-8222-222222222222', name: 'Standard' },
    features: DEFAULT_ENTITLEMENTS.features,
    limits: DEFAULT_ENTITLEMENTS.limits,
    expiresAt: null,
    issuedAt: new Date().toISOString(),
    issuer: 'https://console.example.com',
    audience: 'stk_abcdefghijklmnopqrst',
    ownerContact: { name: 'Provider', email: 'support@example.com' },
    ...over,
  };
}

describe('signing entitlements documents', () => {
  it('produces an envelope the customer stack accepts', () => {
    const { signer } = signerFor();
    const trusted = parsePublicKey(signer.publicKeySpkiBase64);
    const result = verifyEnvelope(signer.sign(document()), [trusted]);
    expect(result.ok ? 'ok' : result.reason).toBe('ok');
    if (!result.ok) return;
    expect(result.document.customerName).toBe('Acme Ltd');
    expect(result.document.audience).toBe('stk_abcdefghijklmnopqrst');
  });

  it('names its key the same way the stack does', () => {
    const { signer } = signerFor();
    const trusted = parsePublicKey(signer.publicKeySpkiBase64);
    expect(signer.keyId).toBe(trusted.keyId);
    expect(signer.keyId).toBe(keyIdOf(Buffer.from(signer.publicKeySpkiBase64, 'base64')));
    expect(signer.keyId).toMatch(/^[0-9a-f]{16}$/);
    expect(signer.sign(document()).keyId).toBe(signer.keyId);
  });

  it('is refused by a stack that trusts a different console', () => {
    const mine = signerFor().signer;
    const theirs = signerFor().signer;
    const result = verifyEnvelope(mine.sign(document()), [
      parsePublicKey(theirs.publicKeySpkiBase64),
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('unknown signing key');
  });

  it('signs the bytes it sends, so a single edited character invalidates it', () => {
    const { signer } = signerFor();
    const trusted = parsePublicKey(signer.publicKeySpkiBase64);
    const envelope = signer.sign(document());
    const payload = JSON.parse(
      Buffer.from(envelope.payload, 'base64url').toString('utf8'),
    ) as EntitlementsDocument;
    payload.customerName = 'Acme Ltd.';
    const edited = {
      ...envelope,
      payload: Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url'),
    };
    const result = verifyEnvelope(edited, [trusted]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('signature does not match');
  });

  it('accepts a document during key rotation, when the stack holds both keys', () => {
    const previous = signerFor().signer;
    const current = signerFor().signer;
    const held = [previous, current].map((s) => parsePublicKey(s.publicKeySpkiBase64));
    expect(verifyEnvelope(previous.sign(document()), held).ok).toBe(true);
    expect(verifyEnvelope(current.sign(document()), held).ok).toBe(true);
  });

  it('refuses to sign something that is not an entitlements document', () => {
    const { signer } = signerFor();
    expect(() => signer.sign(document({ version: 2 as never }))).toThrow();
    expect(() => signer.sign(document({ customerName: '' }))).toThrow();
  });
});
