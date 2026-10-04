/**
 * An admin enters or changes the owner console link in the CRM (docs/21 section 4).
 *
 * Whatever is entered is checked against the console before anything is stored: the console must
 * accept the stack id and secret, and any plan it has waiting must be signed by the key given and
 * addressed to this stack. The secret is encrypted at rest (AES-256-GCM under SECRETS_KEY), never
 * logged, and never returned; the audit row records that it changed, not what it is.
 *
 * The console's address is not returned either, and is kept out of the audit row. A provider's
 * console often sits on a private address, and a customer's admin has no need to read it: they
 * type a new one or leave the field blank to keep the one in use.
 *
 * Changing the address, the stack id or the public key of a link that already exists points the
 * stack at a different console, so the server refuses it until the request says the admin has been
 * warned (`confirmChange`). There is no unlinking: going back to standalone would lift every limit.
 * A link saved here can be dropped only to fall back to one the server's environment carries.
 */
import type {
  ConsoleLinkEnrollBody,
  ConsoleLinkSaveResult,
  ConsoleLinkStatusDto,
} from '@crm/shared';
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

const keyIdsOf = (keys: string[]): string[] =>
  keys.flatMap((k) => {
    try {
      return [parsePublicKey(k).keyId];
    } catch {
      return [];
    }
  });

export class ConsoleLinkService {
  constructor(private readonly app: FastifyInstance) {}

  async status(): Promise<ConsoleLinkStatusDto> {
    const effective = await readConsoleConfig(this.app.db, this.app.config);
    const link = await this.app.entitlements.linkStatus();
    return {
      managedBy: effective.managedBy,
      stackId: effective.credentials?.CONSOLE_STACK_ID ?? null,
      secretSet: effective.credentials !== null,
      publicKeys: effective.publicKeys,
      trustedKeyIds: keyIdsOf(effective.publicKeys),
      locked: effective.locked,
      serverLinkAvailable: effective.serverLinkAvailable,
      connected: link.connected,
      lastHeartbeatAt: link.lastHeartbeatAt,
      updatedAt: effective.updatedAt?.toISOString() ?? null,
    };
  }

  async save(
    actorId: string,
    body: ConsoleLinkEnrollBody,
    ctx: AuditContext,
  ): Promise<ConsoleLinkSaveResult> {
    const current = await readConsoleConfig(this.app.db, this.app.config);
    if (current.locked) {
      throw new ConflictError(
        'The console link on this stack is locked on the server, so it can only be changed there',
      );
    }

    // Blank means "keep what is in use"; on a first link there is nothing to keep.
    const typedUrl = body.consoleUrl !== undefined && body.consoleUrl !== '';
    const typedSecret = body.stackSecret !== undefined && body.stackSecret !== '';
    const consoleUrl = typedUrl
      ? (body.consoleUrl ?? '').replace(/\/+$/, '')
      : current.credentials?.CONSOLE_URL;
    const secret = typedSecret ? body.stackSecret : current.credentials?.CONSOLE_STACK_SECRET;
    const missing: { path: string; message: string }[] = [];
    if (consoleUrl === undefined)
      missing.push({ path: 'consoleUrl', message: 'Enter the console address' });
    if (secret === undefined)
      missing.push({ path: 'stackSecret', message: 'Enter the stack secret' });
    if (consoleUrl === undefined || secret === undefined) throw new ValidationError(missing);

    if (
      typedUrl &&
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

    const changed = {
      address: current.credentials !== null && consoleUrl !== current.credentials.CONSOLE_URL,
      stackId:
        current.credentials !== null && body.stackId !== current.credentials.CONSOLE_STACK_ID,
      key: current.publicKeys.length > 0 && !keyIdsOf(current.publicKeys).includes(key.keyId),
    };
    const repointing = changed.address || changed.stackId || changed.key;
    if (repointing && body.confirmChange !== true) {
      throw new ValidationError([
        {
          path: 'confirmChange',
          message:
            'This points the workspace at a different console. Confirm the change to go ahead.',
        },
      ]);
    }

    // Only an address somebody typed is echoed back in an error; the one in use is never named.
    const named = typedUrl ? `the console at ${consoleUrl}` : 'the console';
    const keyVerified = await this.checkWithConsole(consoleUrl, named, body.stackId, secret, key);
    // A first key may go in unproven, since a stack that trusts none has nothing to lose. A
    // replacement may not: a wrong one would have this stack refuse every plan from then on.
    if (changed.key && !keyVerified) {
      throw new ValidationError([
        {
          path: 'publicKey',
          message:
            'The console has no plan waiting to prove this key with. Issue the plan again from the console, then save.',
        },
      ]);
    }

    const secretEncrypted = encryptJson({ secret }, this.app.config.SECRETS_KEY);
    const data = {
      consoleUrl,
      stackId: body.stackId,
      secretEncrypted,
      publicKeys: [body.publicKey],
      updatedById: actorId,
    };
    await this.app.db.$transaction(async (tx) => {
      await tx.consoleLinkConfig.upsert({
        where: { id: 1 },
        create: { id: 1, ...data },
        update: data,
      });
      await this.app.audit.writeWith(tx, ctx, {
        action: 'console.link_configured',
        entity: 'system',
        before: current.credentials
          ? {
              stackId: current.credentials.CONSOLE_STACK_ID,
              keyIds: keyIdsOf(current.publicKeys),
              managedBy: current.managedBy,
            }
          : null,
        // What changed, never the secret and never the address.
        after: {
          stackId: body.stackId,
          keyId: key.keyId,
          addressChanged: changed.address || (current.credentials === null && typedUrl),
          secretChanged: typedSecret,
          keyChanged: changed.key,
          keyVerified,
        },
      });
    });
    await this.app.valkey.publish(CONSOLE_CONFIG_CHANNEL, 'changed');
    return { ...(await this.status()), keyVerified };
  }

  /**
   * Drops the link saved in the CRM and goes back to the one the server's environment carries.
   * Refused when the environment has none: that would leave the stack standalone, with every
   * limit lifted.
   */
  async useServerLink(ctx: AuditContext): Promise<ConsoleLinkStatusDto> {
    const current = await readConsoleConfig(this.app.db, this.app.config);
    if (current.managedBy !== 'admin') return this.status();
    if (!current.serverLinkAvailable) {
      throw new ConflictError(
        'The server has no console link of its own, so there is nothing to go back to',
      );
    }
    await this.app.db.$transaction(async (tx) => {
      await tx.consoleLinkConfig.deleteMany({ where: { id: 1 } });
      await this.app.audit.writeWith(tx, ctx, {
        action: 'console.link_reset',
        entity: 'system',
        before: {
          stackId: current.credentials?.CONSOLE_STACK_ID ?? null,
          keyIds: keyIdsOf(current.publicKeys),
        },
        after: { managedBy: 'server' },
      });
    });
    await this.app.valkey.publish(CONSOLE_CONFIG_CHANNEL, 'changed');
    return this.status();
  }

  /**
   * Asks the console whether it knows this stack, with exactly the request the worker makes at
   * boot, and checks any waiting plan is signed by the given key and addressed to this stack.
   * Nothing is applied or acknowledged here: the worker does that once the link is saved. Only the
   * status of the answer is used, so a wrong address cannot be used to read another server's
   * responses back. Returns whether the key was actually proven against a signed plan; with
   * nothing waiting it cannot be, and the caller says so.
   */
  private async checkWithConsole(
    consoleUrl: string,
    named: string,
    stackId: string,
    secret: string,
    key: TrustedKey,
  ): Promise<boolean> {
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
      throw new ServiceUnavailableError(`Could not reach ${named}`);
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
        `${named.charAt(0).toUpperCase()}${named.slice(1)} answered ${String(status)}; check the address`,
      );
    }
    if (status === 204) return false;
    const parsed = linkEntitlementsResponse.safeParse(body);
    if (!parsed.success) {
      throw new ServiceUnavailableError('That address is not an owner console');
    }
    if (parsed.data === null) return false;
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
    return true;
  }
}
