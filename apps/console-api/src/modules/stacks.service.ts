/**
 * Stack credentials (docs/21).
 *
 * A stack proves who it is with an id and a secret. The secret is generated here, shown once,
 * and only ever stored as a hash: if this database leaks, it does not hand anyone a working
 * connection to a customer's CRM.
 */
import { randomBytes } from 'node:crypto';
import { hashPassword, verifyPassword } from 'better-auth/crypto';
import type { Db } from '../plugins/prisma.js';

/** Crockford-ish base32, no vowels or lookalikes, so an id read aloud is unambiguous. */
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

export function newStackId(): string {
  const bytes = randomBytes(20);
  let out = '';
  for (const b of bytes) out += ALPHABET.charAt(b % 32);
  return `stk_${out}`;
}

export function newStackSecret(): string {
  return randomBytes(32).toString('base64url');
}

export interface NewStack {
  stackId: string;
  /** Shown once. Never stored, never logged, never recoverable. */
  secret: string;
  envLines: string[];
}

export class StacksService {
  constructor(
    private readonly db: Db,
    private readonly consoleUrl: string,
    private readonly publicKeySpkiBase64: string,
  ) {}

  /** The four lines an operator pastes into the customer's .env, ready to copy. */
  envLines(stackId: string, secret: string): string[] {
    return [
      `CONSOLE_URL=${this.consoleUrl}`,
      `CONSOLE_STACK_ID=${stackId}`,
      `CONSOLE_STACK_SECRET=${secret}`,
      `CONSOLE_PUBLIC_KEY=${this.publicKeySpkiBase64}`,
    ];
  }

  async create(customerId: string, label = 'primary'): Promise<NewStack> {
    const stackId = newStackId();
    const secret = newStackSecret();
    await this.db.stack.create({
      data: { id: stackId, customerId, label, secretHash: await hashPassword(secret) },
    });
    return { stackId, secret, envLines: this.envLines(stackId, secret) };
  }

  /** A new secret for the same id, so the customer's stack id does not change. */
  async rotate(stackId: string): Promise<NewStack> {
    const secret = newStackSecret();
    await this.db.stack.update({
      where: { id: stackId },
      data: { secretHash: await hashPassword(secret), rotatedAt: new Date(), connected: false },
    });
    return { stackId, secret, envLines: this.envLines(stackId, secret) };
  }

  async revoke(stackId: string): Promise<void> {
    await this.db.stack.update({
      where: { id: stackId },
      data: { revokedAt: new Date(), connected: false },
    });
  }

  /**
   * Checks a presented credential. Returns the stack only when the secret matches and the stack
   * has not been revoked; every failure looks the same from outside.
   */
  async authenticate(
    stackId: string,
    secret: string,
  ): Promise<{ id: string; customerId: string } | null> {
    const stack = await this.db.stack.findUnique({
      where: { id: stackId },
      select: { id: true, customerId: true, secretHash: true, revokedAt: true },
    });
    if (stack?.revokedAt !== null) return null;
    const ok = await verifyPassword({ hash: stack.secretHash, password: secret });
    return ok ? { id: stack.id, customerId: stack.customerId } : null;
  }
}
