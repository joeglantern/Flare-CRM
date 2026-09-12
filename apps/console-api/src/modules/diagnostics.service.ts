/**
 * Asking a customer's stack how it is doing (docs/21 §9).
 *
 * The fourth door beside the three support actions, and the narrowest of them: the stack answers
 * with counts, states and timestamps about itself, and nothing over there changes. There is no
 * action to take and nothing to undo, which is why this needs only the permission to read a stack.
 *
 * The facts are shown and not stored. A snapshot kept in a table is a number that was true once and
 * goes on looking current, and the honest way to know how a stack is now is to ask it again. What is
 * recorded is that somebody looked, here and in the customer's own log.
 */
import { randomUUID } from 'node:crypto';
import { diagnostics as diagnosticsSchema, type Diagnostics } from '@crm/shared';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import { STACK_ANSWER_MS, STACK_SILENT_MESSAGE } from '../lib/stack-wait.js';
import type { ConsoleLink } from '../plugins/link.js';
import type { Db } from '../plugins/prisma.js';
import type { AuditContext, AuditService } from './audit.service.js';

export interface DiagnosticsOutcome {
  ok: boolean;
  message: string | null;
  stackId: string;
  facts: Diagnostics['facts'] | null;
}

export class DiagnosticsService {
  constructor(private readonly deps: { db: Db; link: ConsoleLink; audit: AuditService }) {}

  async read(
    customerId: string,
    requestedBy: string,
    ctx: AuditContext,
  ): Promise<DiagnosticsOutcome> {
    const customer = await this.deps.db.customer.findUnique({
      where: { id: customerId },
      select: { id: true },
    });
    if (!customer) throw new NotFoundError('Customer');

    const stack = await this.deps.db.stack.findFirst({
      where: { customerId: customer.id, revokedAt: null, connected: true },
      select: { id: true },
      orderBy: { lastSeenAt: 'desc' },
    });
    if (!stack) {
      throw new ConflictError(
        'This customer’s stack is not connected, so there is nothing to ask right now',
      );
    }

    const commandId = `cmd_${randomUUID()}`;
    // Audited before it is asked, the same as a support action: looking at somebody else's
    // installation is worth a row whether or not they answered.
    await this.deps.audit.write(ctx, {
      action: 'stack.diagnostics',
      entity: 'customer',
      entityId: customer.id,
      after: { commandId, stackId: stack.id },
    });

    const answer = await this.deps.link.diagnose(
      stack.id,
      { commandId, requestedBy },
      STACK_ANSWER_MS,
    );
    const outcome = this.parse(answer, stack.id);

    await this.deps.audit.write(ctx, {
      action: 'stack.diagnostics.result',
      entity: 'customer',
      entityId: customer.id,
      // The facts themselves are not audited. They are a snapshot of somebody's machine, and the
      // row is here to say that we looked, not to keep a copy of what we saw.
      after: { commandId, ok: outcome.ok, message: outcome.message },
    });
    return outcome;
  }

  private parse(answer: unknown, stackId: string): DiagnosticsOutcome {
    if (answer === null) {
      return {
        ok: false,
        message: STACK_SILENT_MESSAGE,
        stackId,
        facts: null,
      };
    }
    const parsed = diagnosticsSchema.safeParse(answer);
    if (!parsed.success) {
      return {
        ok: false,
        message: 'The stack answered with something unreadable.',
        stackId,
        facts: null,
      };
    }
    return {
      ok: parsed.data.ok,
      message: parsed.data.message ?? null,
      stackId,
      facts: parsed.data.facts ?? null,
    };
  }
}
