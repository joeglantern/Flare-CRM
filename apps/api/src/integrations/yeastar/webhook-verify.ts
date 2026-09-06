/**
 * Yeastar webhook signature (docs/06 §6, docs/08 H1): X-Signature = base64(HMAC-SHA256(rawBody, secret)).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export function yeastarSignature(rawBody: Buffer, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('base64');
}

export function verifyYeastarSignature(
  rawBody: Buffer,
  secret: string,
  header: string | undefined,
): boolean {
  if (!header) return false;
  const expected = Buffer.from(yeastarSignature(rawBody, secret), 'utf8');
  const provided = Buffer.from(header.trim(), 'utf8');
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}
