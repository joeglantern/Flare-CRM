/**
 * Signing entitlements documents (docs/20 §3, docs/21).
 *
 * The console holds the only private key; every customer stack carries the public half and
 * refuses anything else. The bytes signed are exactly the ones sent, so no formatting difference
 * between the two services can invalidate a document.
 */
import { createHash, createPrivateKey, createPublicKey, sign, type KeyObject } from 'node:crypto';
import { entitlementsDocument, type EntitlementsDocument, type SignedEnvelope } from '@crm/shared';
import type { Env } from '../config/env.js';

export interface Signer {
  keyId: string;
  publicKeySpkiBase64: string;
  sign: (document: EntitlementsDocument) => SignedEnvelope;
}

export function keyIdOf(spkiDer: Buffer): string {
  return createHash('sha256').update(spkiDer).digest('hex').slice(0, 16);
}

export function createSigner(env: Env): Signer {
  const privateKey: KeyObject = createPrivateKey({
    key: Buffer.from(env.CONSOLE_SIGNING_KEY, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
  const spki = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  const keyId = keyIdOf(spki);
  return {
    keyId,
    publicKeySpkiBase64: spki.toString('base64'),
    sign(document) {
      // Parsed on the way out as well as in: a document that would fail the stack's own check
      // should never leave here in the first place.
      const payload = Buffer.from(JSON.stringify(entitlementsDocument.parse(document)), 'utf8');
      return {
        payload: payload.toString('base64url'),
        signature: sign(null, payload, privateKey).toString('base64url'),
        keyId,
      };
    },
  };
}
