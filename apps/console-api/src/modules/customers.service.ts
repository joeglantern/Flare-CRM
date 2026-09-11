/**
 * A customer's life after it is created: filed away when we stop working with them, and brought
 * back when we start again.
 *
 * Archiving is not deletion and not a status. Nothing is removed, and their own CRM learns about it
 * the only way it ever learns anything: a freshly signed document with an expiry of now, which is
 * what read only means (docs/21 §5). Doing that here rather than in the route is what lets the same
 * act be reached from a bulk action later without the two drifting apart.
 */
import type { ChurnReason, OwnerContact } from '@crm/shared';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import type { AuditContext, AuditService } from './audit.service.js';
import type { ConsoleEntitlementsService } from './entitlements.service.js';
import type { ConsoleLink } from '../plugins/link.js';
import type { Db } from '../plugins/prisma.js';

export interface CustomersDeps {
  db: Db;
  audit: AuditService;
  entitlements: ConsoleEntitlementsService;
  link: ConsoleLink;
  ownerContact: () => Promise<OwnerContact>;
}

export interface ArchiveInput {
  customerId: string;
  reason: ChurnReason;
  note?: string | undefined;
  actorId: string;
  ctx: AuditContext;
}

type CustomerRow = Awaited<ReturnType<Db['customer']['findUniqueOrThrow']>>;

export class CustomersService {
  constructor(private readonly deps: CustomersDeps) {}

  /**
   * Files a customer away and makes it true on their own server.
   *
   * Their status becomes churned, which is what holds them read only, and the held document goes out
   * at once. A stack that is offline collects it the moment it reconnects, exactly as it would for
   * any other change.
   */
  async archive(input: ArchiveInput): Promise<CustomerRow> {
    const before = await this.deps.db.customer.findUnique({ where: { id: input.customerId } });
    if (!before) throw new NotFoundError('Customer');
    if (before.archivedAt !== null) throw new ConflictError('That customer is already archived');

    const now = new Date();
    await this.deps.db.customer.update({
      where: { id: input.customerId },
      data: {
        archivedAt: now,
        archivedById: input.actorId,
        archiveReason: input.note ?? null,
        churnReason: input.reason,
        ...(before.churnedAt === null ? { churnedAt: now } : {}),
        status: 'churned',
      },
    });

    const enforcement = await this.hold(before.id, before.status, input.actorId);
    const after = await this.deps.db.customer.findUniqueOrThrow({
      where: { id: input.customerId },
    });
    await this.deps.audit.write(input.ctx, {
      action: 'customer.archive',
      entity: 'customer',
      entityId: after.id,
      before: { status: before.status, archivedAt: null },
      after: {
        status: after.status,
        churnReason: input.reason,
        note: input.note ?? null,
        ...(enforcement === null ? {} : { enforcement }),
      },
    });
    return after;
  }

  /**
   * Takes a customer back out of the drawer. Their status stays churned on purpose: being wrong
   * about having filed somebody is not the same as their plan being live again, and putting them
   * back to active is the status control saying so, with the document that goes with it.
   */
  async unarchive(customerId: string, ctx: AuditContext): Promise<CustomerRow> {
    const before = await this.deps.db.customer.findUnique({ where: { id: customerId } });
    if (!before) throw new NotFoundError('Customer');
    if (before.archivedAt === null) throw new ConflictError('That customer is not archived');

    await this.deps.db.customer.update({
      where: { id: customerId },
      data: { archivedAt: null, archivedById: null, archiveReason: null },
    });
    const after = await this.deps.db.customer.findUniqueOrThrow({ where: { id: customerId } });
    await this.deps.audit.write(ctx, {
      action: 'customer.unarchive',
      entity: 'customer',
      entityId: after.id,
      before: { archivedAt: before.archivedAt.toISOString(), status: before.status },
      after: { archivedAt: null, status: after.status },
    });
    return after;
  }

  /**
   * The same two steps the status control takes: expire what they hold, then sign and send it.
   * Skipped when they were already churned, because the document they hold already says so.
   */
  private async hold(
    customerId: string,
    previousStatus: string,
    actorId: string,
  ): Promise<{ held: true; issues: number } | null> {
    if (previousStatus === 'churned') return null;
    const changed = await this.deps.entitlements.hold(customerId);
    if (!changed) return null;
    const issued = await this.deps.entitlements.issue(
      customerId,
      actorId,
      await this.deps.ownerContact(),
    );
    await this.deps.link.deliver(issued);
    return { held: true, issues: issued.length };
  }
}
