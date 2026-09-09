/**
 * Ed25519 signing and verification of entitlements documents (docs/20 §3).
 *
 * The signed bytes are exactly the base64url-decoded `payload`; nothing is ever re-serialised on
 * either side, so a document survives any JSON formatting difference between console and stack.
 * `keyId` identifies the console key so a stack can hold more than one during rotation.
 */
import { createHash, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';
import { entitlementsDocument, type EntitlementsDocument, type SignedEnvelope } from '@crm/shared';

export interface TrustedKey {
  keyId: string;
  key: KeyObject;
}

/** First 16 hex characters of the SHA-256 of the SPKI DER encoding. */
export function keyIdOf(spkiDer: Buffer): string {
  return createHash('sha256').update(spkiDer).digest('hex').slice(0, 16);
}

export function parsePublicKey(spkiBase64: string): TrustedKey {
  const der = Buffer.from(spkiBase64, 'base64');
  const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error('Console public key must be an Ed25519 key');
  }
  return { keyId: keyIdOf(der), key };
}

export type VerifyResult =
  { ok: true; payload: Buffer; document: EntitlementsDocument } | { ok: false; reason: string };

export function verifyEnvelope(
  envelope: SignedEnvelope,
  keys: readonly TrustedKey[],
): VerifyResult {
  const trusted = keys.find((k) => k.keyId === envelope.keyId);
  if (!trusted) return { ok: false, reason: `unknown signing key ${envelope.keyId}` };
  const payload = Buffer.from(envelope.payload, 'base64url');
  const signature = Buffer.from(envelope.signature, 'base64url');
  if (signature.length !== 64) return { ok: false, reason: 'signature has the wrong length' };
  if (!verify(null, payload, trusted.key, signature)) {
    return { ok: false, reason: 'signature does not match the payload' };
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(payload.toString('utf8'));
  } catch {
    return { ok: false, reason: 'payload is not JSON' };
  }
  const document = entitlementsDocument.safeParse(parsedJson);
  if (!document.success) {
    return {
      ok: false,
      reason: `payload is not an entitlements document: ${document.error.message}`,
    };
  }
  return { ok: true, payload, document: document.data };
}

/**
 * Produces an envelope for a document. Used by the owner console and by tests; a customer stack
 * never holds a private key.
 */
export function signDocument(
  document: EntitlementsDocument,
  privateKey: KeyObject,
): SignedEnvelope {
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('Signing key must be an Ed25519 key');
  }
  const payload = Buffer.from(JSON.stringify(entitlementsDocument.parse(document)), 'utf8');
  const signature = sign(null, payload, privateKey);
  const spki = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  return {
    payload: payload.toString('base64url'),
    signature: signature.toString('base64url'),
    keyId: keyIdOf(spki),
  };
}
