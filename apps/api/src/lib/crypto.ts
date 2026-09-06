/**
 * AES-256-GCM for third-party secrets stored in the database (docs/08 F2).
 * Format: base64( keyId(1) | iv(12) | tag(16) | ciphertext ). keyId allows rotation.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const KEY_ID = 1;

export function encryptJson(value: unknown, keyHex: string): Uint8Array<ArrayBuffer> {
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) throw new Error('SECRETS_KEY must be 32 bytes');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const out = Buffer.concat([Buffer.from([KEY_ID]), iv, tag, ciphertext]);
  return new Uint8Array(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength));
}

export function decryptJson(input: Uint8Array, keyHex: string): unknown {
  const blob = Buffer.from(input);
  const key = Buffer.from(keyHex, 'hex');
  if (blob.length < 1 + 12 + 16) throw new Error('ciphertext too short');
  const keyId = blob[0];
  if (keyId !== KEY_ID) throw new Error(`unknown secrets key id ${String(keyId)}`);
  const iv = blob.subarray(1, 13);
  const tag = blob.subarray(13, 29);
  const ciphertext = blob.subarray(29);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8'));
}
