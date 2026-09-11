/**
 * A customer's life after it is created: filed away when we stop working with them, and brought
 * back when we start again.
 *
 * Archiving is not deletion and not a status. Nothing is removed, and their own CRM learns about it
 * the only way it ever learns anything: a freshly signed document with an expiry of now, which is
 * what read only means (docs/21 §5). Doing that here rather than in the route is what lets the same
 * act be reached from a bulk action later without the two drifting apart.
 */
import type { ChurnReason, CustomerFilter, CustomerStatus, OwnerContact } from '@crm/shared';
import type { Prisma } from '../generated/prisma/client.js';
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
type StackRow = Awaited<ReturnType<Db['stack']['findUniqueOrThrow']>>;
type Effective = Awaited<ReturnType<ConsoleEntitlementsService['effective']>>;

export interface Page {
  page: number;
  pageSize: number;
  total: number;
}

export interface FleetRow {
  customer: CustomerRow;
  stacks: StackRow[];
  effective: Effective;
}

/** What one customer in a bulk action ended up doing, so a partial failure is legible. */
export interface BulkOutcome {
  customerId: string;
  ok: boolean;
  error?: string;
}

export class CustomersService {
  constructor(private readonly deps: CustomersDeps) {}

  /**
   * The filter every list here shares. Archived customers are out of the way unless asked for:
   * the fleet is who we are working with, and somebody who left should not be in the way of that
   * while still being one click from view.
   */
  private where(filter: CustomerFilter): Prisma.CustomerWhereInput {
    const and: Prisma.CustomerWhereInput[] = [];
    if (filter.archived === 'exclude') and.push({ archivedAt: null });
    if (filter.archived === 'only') and.push({ archivedAt: { not: null } });
    if (filter.status !== undefined && filter.status.length > 0) {
      and.push({ status: { in: filter.status } });
    }
    if (filter.onboardingStage !== undefined) {
      and.push({ onboardingStage: filter.onboardingStage });
    }
    if (filter.planId !== undefined) and.push({ entitlement: { planId: filter.planId } });
    if (filter.expiringWithinDays !== undefined) {
      const until = new Date(Date.now() + filter.expiringWithinDays * 86_400_000);
      and.push({ entitlement: { expiresAt: { not: null, lte: until } } });
    }
    if (filter.q !== undefined && filter.q !== '') {
      const q = filter.q;
      and.push({
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { slug: { contains: q.toLowerCase() } },
          { primaryDomain: { contains: q.toLowerCase() } },
          { customDomain: { contains: q.toLowerCase() } },
          { contactEmail: { contains: q, mode: 'insensitive' } },
        ],
      });
    }
    return and.length === 0 ? {} : { AND: and };
  }

  /** Customers alone, for the places that only need who exists. */
  async list(filter: CustomerFilter): Promise<{ rows: CustomerRow[]; page: Page }> {
    const where = this.where(filter);
    const [total, rows] = await Promise.all([
      this.deps.db.customer.count({ where }),
      this.deps.db.customer.findMany({
        where,
        orderBy: { name: filter.direction },
        skip: (filter.page - 1) * filter.pageSize,
        take: filter.pageSize,
      }),
    ]);
    return { rows, page: { page: filter.page, pageSize: filter.pageSize, total } };
  }

  /**
   * The fleet: every customer with their stacks and what they are entitled to.
   *
   * Sorting by last seen or by expiry is done after loading rather than in SQL, because both live
   * off the customer row, and the page is a few dozen businesses rather than a table of contacts.
   * Filtering and counting still happen in the database, so the page numbers are true.
   */
  async fleet(filter: CustomerFilter): Promise<{ rows: FleetRow[]; page: Page }> {
    const where = this.where(filter);
    const matching = await this.deps.db.customer.findMany({
      where,
      include: { stacks: { orderBy: { createdAt: 'asc' } } },
    });

    const withEntitlements: FleetRow[] = [];
    for (const customer of matching) {
      const { stacks, ...rest } = customer;
      withEntitlements.push({
        customer: rest,
        stacks: stacks.filter((s) => s.revokedAt === null),
        effective: await this.deps.entitlements.effective(customer.id),
      });
    }

    const connected = filter.connected;
    const rows =
      connected === undefined
        ? withEntitlements
        : withEntitlements.filter(
            (r) => r.stacks.some((s) => s.connected) === (connected === 'true'),
          );

    rows.sort((a, b) => this.compare(a, b, filter) * (filter.direction === 'desc' ? -1 : 1));
    const start = (filter.page - 1) * filter.pageSize;
    return {
      rows: rows.slice(start, start + filter.pageSize),
      page: { page: filter.page, pageSize: filter.pageSize, total: rows.length },
    };
  }

  private compare(a: FleetRow, b: FleetRow, filter: CustomerFilter): number {
    if (filter.sort === 'createdAt') {
      return a.customer.createdAt.getTime() - b.customer.createdAt.getTime();
    }
    if (filter.sort === 'lastSeenAt') {
      return lastSeen(a) - lastSeen(b);
    }
    if (filter.sort === 'expiresAt') {
      // No expiry sorts last whichever way the column is pointed: "never" is not a date.
      const left = a.effective.expiresAt === null ? Infinity : Date.parse(a.effective.expiresAt);
      const right = b.effective.expiresAt === null ? Infinity : Date.parse(b.effective.expiresAt);
      return left - right;
    }
    return a.customer.name.localeCompare(b.customer.name);
  }

  /**
   * Changing a status, and making it true on their server.
   *
   * Lives here rather than in the route so that one customer and a hundred of them take exactly the
   * same path: expire or restore what they hold, sign it, and send it.
   */
  async setStatus(
    customerId: string,
    status: CustomerStatus,
    actorId: string,
  ): Promise<{ changed: boolean; held: boolean; issues: number }> {
    const before = await this.deps.db.customer.findUnique({ where: { id: customerId } });
    if (!before) throw new NotFoundError('Customer');
    if (before.status === status) return { changed: false, held: false, issues: 0 };

    await this.deps.db.customer.update({
      where: { id: customerId },
      data: {
        status,
        ...(status === 'churned' && before.churnedAt === null ? { churnedAt: new Date() } : {}),
      },
    });
    const moved =
      status === 'active'
        ? await this.deps.entitlements.release(customerId)
        : await this.deps.entitlements.hold(customerId);
    if (!moved) return { changed: true, held: status !== 'active', issues: 0 };

    const issued = await this.deps.entitlements.issue(
      customerId,
      actorId,
      await this.deps.ownerContact(),
    );
    await this.deps.link.deliver(issued);
    return { changed: true, held: status !== 'active', issues: issued.length };
  }

  /**
   * The same act, over a list. Sequential and capped: each one signs a document and pushes it down
   * a socket, and a hundred of those at once on a single process is a way to make the console
   * unreachable while it works. One customer failing does not stop the rest.
   */
  async bulk(
    ids: string[],
    run: (customerId: string) => Promise<void>,
  ): Promise<{ results: BulkOutcome[]; ok: number; failed: number }> {
    const results: BulkOutcome[] = [];
    for (const customerId of ids) {
      try {
        await run(customerId);
        results.push({ customerId, ok: true });
      } catch (err: unknown) {
        results.push({
          customerId,
          ok: false,
          error: err instanceof Error ? err.message : 'That one failed',
        });
      }
    }
    return {
      results,
      ok: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
    };
  }

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

    const enforcement = await this.holdForArchive(before.id, before.status, input.actorId);
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
  private async holdForArchive(
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

/** The newest thing any of a customer's stacks said, or nothing at all. */
function lastSeen(row: FleetRow): number {
  return row.stacks.reduce(
    (newest, stack) => Math.max(newest, stack.lastSeenAt?.getTime() ?? 0),
    0,
  );
}
