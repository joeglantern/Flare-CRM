/**
 * Support actions performed on a customer's stack, at that customer's request (docs/21 §9).
 *
 * This is a door into somebody else's system, so it is built like one. Three actions, no more: see
 * who can sign in, reset one person's second factor, end one person's sessions. Nothing reads a
 * contact, a call or a message. Every request and every result is audited here, and the stack
 * audits it again in the customer's own log where their administrator can see it.
 *
 * A command only reaches a stack that is connected right now. There is no queue: a support action
 * that arrives an hour later, after the conversation has moved on, is worse than one that fails.
 */
import { randomUUID } from 'node:crypto';
import {
  supportResult,
  type SupportAction,
  type SupportResult,
  type SupportUser,
} from '@crm/shared';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import { STACK_ANSWER_MS, STACK_SILENT_MESSAGE } from '../lib/stack-wait.js';
import type { ConsoleLink } from '../plugins/link.js';
import type { Db } from '../plugins/prisma.js';
import type { AuditContext, AuditService } from './audit.service.js';

export interface SupportRequest {
  customerId: string;
  action: SupportAction;
  email?: string;
  reason?: string;
  requestedBy: string;
}

export interface SupportOutcome {
  ok: boolean;
  message: string | null;
  users: SupportUser[];
  stackId: string;
}

export class SupportService {
  constructor(private readonly deps: { db: Db; link: ConsoleLink; audit: AuditService }) {}

  async run(request: SupportRequest, ctx: AuditContext): Promise<SupportOutcome> {
    const customer = await this.deps.db.customer.findUnique({
      where: { id: request.customerId },
      select: { id: true, name: true },
    });
    if (!customer) throw new NotFoundError('Customer');

    const stack = await this.deps.db.stack.findFirst({
      where: { customerId: customer.id, revokedAt: null, connected: true },
      select: { id: true },
      orderBy: { lastSeenAt: 'desc' },
    });
    if (!stack) {
      throw new ConflictError(
        'This customer’s stack is not connected, so nothing can be done on it right now',
      );
    }

    const commandId = `cmd_${randomUUID()}`;
    // Audited before it is sent. A command that vanished into a socket still happened, and the
    // owner asking why should find the attempt rather than silence.
    await this.deps.audit.write(ctx, {
      action: `support.${request.action}`,
      entity: 'customer',
      entityId: customer.id,
      after: {
        commandId,
        stackId: stack.id,
        email: request.email ?? null,
        reason: request.reason ?? null,
      },
    });

    const answer = await this.deps.link.command(
      stack.id,
      {
        commandId,
        action: request.action,
        ...(request.email === undefined ? {} : { email: request.email }),
        ...(request.reason === undefined ? {} : { reason: request.reason }),
        requestedBy: request.requestedBy,
      },
      STACK_ANSWER_MS,
    );

    const outcome = this.read(answer, stack.id);
    await this.deps.audit.write(ctx, {
      action: `support.${request.action}.result`,
      entity: 'customer',
      entityId: customer.id,
      after: {
        commandId,
        ok: outcome.ok,
        message: outcome.message,
        // The list itself is not audited: it is the customer's people, and we only needed to look.
        users: request.action === 'list-users' ? outcome.users.length : undefined,
      },
    });
    return outcome;
  }

  private read(answer: unknown, stackId: string): SupportOutcome {
    if (answer === null) {
      return {
        ok: false,
        message: STACK_SILENT_MESSAGE,
        users: [],
        stackId,
      };
    }
    const parsed = supportResult.safeParse(answer);
    if (!parsed.success) {
      return {
        ok: false,
        message: 'The stack answered with something unreadable.',
        users: [],
        stackId,
      };
    }
    const result: SupportResult = parsed.data;
    return {
      ok: result.ok,
      message: result.message ?? null,
      users: result.users ?? [],
      stackId,
    };
  }
}
