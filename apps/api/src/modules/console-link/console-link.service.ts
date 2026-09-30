/**
 * An admin enters the owner console link in the CRM instead of the server's .env (docs/21 section 4).
 *
 * The four values the console issues go in together and are checked against the console before
 * anything is stored: the console must accept the stack id and secret, and any document it has
 * waiting must be signed by the key given. The secret is encrypted at rest (AES-256-GCM under
 * SECRETS_KEY), never logged, and never returned; the audit row records that it changed, not what
 * it is.
 *
 * The public key is what makes a plan tamper-proof, so the GUI may introduce one only on a stack
 * that trusts none yet. Such a stack runs standalone with every feature on, so trusting a first key
 * can take nothing away. Once a key is trusted, only a key already trusted is accepted here, and
 * there is no way to unlink from the GUI: dropping back to standalone would lift every limit.
 * Replacing a trusted key is an operator's job, on the server.
 */
import type { ConsoleLinkEnrollBody, ConsoleLinkStatusDto } from '@crm/shared';
import { linkEntitlementsResponse } from '@crm/shared';
import type { FastifyInstance } from 'fastify';
import { request } from 'undici';
import { isOnThisMachine } from '../../config/env.js';
import { encryptJson } from '../../lib/crypto.js';
import { ConflictError, ServiceUnavailableError, ValidationError } from '../../lib/errors.js';
import type { AuditContext } from '../audit/audit.service.js';
import { parsePublicKey, verifyEnvelope, type TrustedKey } from '../entitlements/signature.js';
import { CONSOLE_CONFIG_CHANNEL, readConsoleConfig } from './config.js';

const CHECK_TIMEOUT_MS = 10_000;

export class ConsoleLinkService {
  constructor(private readonly app: FastifyInstance) {}

  async status(): Promise<ConsoleLinkStatusDto> {
    const effective = await readConsoleConfig(this.app.db, this.app.config);
    const link = await this.app.entitlements.linkStatus();
    return {
      managedBy: effective.managedBy,
      consoleUrl: effective.credentials?.CONSOLE_URL ?? null,
      stackId: effective.credentials?.CONSOLE_STACK_ID ?? null,
      secretSet: effective.credentials !== null,
      trustedKeyIds: effective.publicKeys.flatMap((k) => {
        try {
          return [parsePublicKey(k).keyId];
        } catch {
          return [];
        }
      }),
      connected: link.connected,
      lastHeartbeatAt: link.lastHeartbeatAt,
      updatedAt: effective.updatedAt?.toISOString() ?? null,
    };
  }

  async enroll(
    actorId: string,
    body: ConsoleLinkEnrollBody,
    ctx: AuditContext,
  ): Promise<ConsoleLinkStatusDto> {
    const current = await readConsoleConfig(this.app.db, this.app.config);
    if (current.managedBy === 'server') {
      throw new ConflictError(
        'The console link on this stack is set on the server, so it can only be changed there',
      );
    }

    const consoleUrl = body.consoleUrl.replace(/\/+$/, '');
    if (
      this.app.config.NODE_ENV === 'production' &&
      !consoleUrl.startsWith('https://') &&
      !isOnThisMachine(consoleUrl)
    ) {
      throw new ValidationError([
        { path: 'consoleUrl', message: 'The console address must start with https://' },
      ]);
    }

    let key: TrustedKey;
    try {
      key = parsePublicKey(body.publicKey);
    } catch {
      throw new ValidationError([
        { path: 'publicKey', message: 'This is not a console public key' },
      ]);
    }
    const trusted = current.publicKeys.flatMap((k) => {
      try {
        return [parsePublicKey(k)];
      } catch {
        return [];
      }
    });
    if (trusted.length > 0 && !trusted.some((t) => t.keyId === key.keyId)) {
      throw new ConflictError(
        'This stack already trusts a console key, and a different one can only be set on the server',
      );
    }

    await this.checkWithConsole(consoleUrl, body.stackId, body.stackSecret, key);

    const publicKeys = trusted.length > 0 ? current.publicKeys : [body.publicKey];
    const secretEncrypted = encryptJson({ secret: body.stackSecret }, this.app.config.SECRETS_KEY);
    await this.app.db.$transaction(async (tx) => {
      await tx.consoleLinkConfig.upsert({
        where: { id: 1 },
        create: {
          id: 1,
          consoleUrl,
          stackId: body.stackId,
          secretEncrypted,
          publicKeys,
          updatedById: actorId,
        },
        update: {
          consoleUrl,
          stackId: body.stackId,
          secretEncrypted,
          publicKeys,
          updatedById: actorId,
        },
      });
      await this.app.audit.writeWith(tx, ctx, {
        action: 'console.link_configured',
        entity: 'system',
        before: current.credentials
          ? {
              consoleUrl: current.credentials.CONSOLE_URL,
              stackId: current.credentials.CONSOLE_STACK_ID,
            }
          : null,
        // What changed, never the secret itself.
        after: { consoleUrl, stackId: body.stackId, keyId: key.keyId, secret: 'replaced' },
      });
    });
    await this.app.valkey.publish(CONSOLE_CONFIG_CHANNEL, 'changed');
    return this.status();
  }

  /**
   * Asks the console whether it knows this stack, with exactly the request the worker makes at
   * boot, and checks any waiting document is signed by the given key. Nothing is applied or
   * acknowledged here: the worker does that once the link is saved. Only the status of the answer
   * is used, so a wrong address cannot be used to read another server's responses back.
   */
  private async checkWithConsole(
    consoleUrl: string,
    stackId: string,
    secret: string,
    key: TrustedKey,
  ): Promise<void> {
    let status: number;
    let body: unknown = null;
    try {
      const response = await request(`${consoleUrl}/api/link/entitlements`, {
        method: 'GET',
        headers: { authorization: `Bearer ${stackId}.${secret}`, accept: 'application/json' },
        headersTimeout: CHECK_TIMEOUT_MS,
        bodyTimeout: CHECK_TIMEOUT_MS,
      });
      status = response.statusCode;
      if (status === 200) body = await response.body.json().catch(() => null);
      else await response.body.dump();
    } catch {
      throw new ServiceUnavailableError(`Could not reach the console at ${consoleUrl}`);
    }
    if (status === 401 || status === 403) {
      throw new ValidationError([
        {
          path: 'stackSecret',
          message: 'The console did not accept this stack id and secret',
        },
      ]);
    }
    if (status !== 200 && status !== 204) {
      throw new ServiceUnavailableError(
        `The console at ${consoleUrl} answered ${String(status)}; check the address`,
      );
    }
    if (status === 200) {
      const parsed = linkEntitlementsResponse.safeParse(body);
      if (!parsed.success) {
        throw new ServiceUnavailableError(`The address ${consoleUrl} is not an owner console`);
      }
      if (parsed.data !== null) {
        const verified = verifyEnvelope(parsed.data.envelope, [key]);
        if (!verified.ok) {
          throw new ValidationError([
            {
              path: 'publicKey',
              message: 'This console signs its plans with a different key than the one given',
            },
          ]);
        }
        if (verified.document.audience !== undefined && verified.document.audience !== stackId) {
          throw new ValidationError([
            { path: 'stackId', message: 'The console issued this plan to a different stack' },
          ]);
        }
      }
    }
  }
}
