/**
 * What a customer is actually entitled to, and issuing it (docs/21).
 *
 * A customer sits on a plan and may have overrides on top. The effective set is the plan merged
 * with the overrides, normalised so no incoherent combination can be issued. Issuing signs one
 * document per stack, addressed to that stack, and supersedes anything still outstanding.
 */
import {
  DEFAULT_ENTITLEMENTS,
  featureKeys,
  limitKeys,
  normaliseFeatures,
  type EntitlementsDocument,
  type FeatureKey,
  type FeatureMap,
  type LimitKey,
  type LimitMap,
  type OwnerContact,
} from '@crm/shared';
import { newId } from '../lib/ids.js';
import type { Db } from '../plugins/prisma.js';
import type { Signer } from '../lib/signing.js';

export interface EffectiveEntitlements {
  plan: { id: string; name: string } | null;
  features: FeatureMap;
  limits: LimitMap;
  expiresAt: string | null;
  /** Minor units: the customer's override where there is one, otherwise the plan's price. */
  priceMonthlyMinor: number | null;
  currency: string;
}

/** "iss_" plus a uuid, so a log line says what kind of id it is looking at. */
export function newIssueId(): string {
  return `iss_${newId()}`;
}

function asFeatureOverrides(value: unknown): Partial<FeatureMap> {
  const raw = (value ?? {}) as Record<string, unknown>;
  const out: Partial<FeatureMap> = {};
  for (const key of featureKeys) if (typeof raw[key] === 'boolean') out[key] = raw[key];
  return out;
}

function asLimitOverrides(value: unknown): Partial<LimitMap> {
  const raw = (value ?? {}) as Record<string, unknown>;
  const out: Partial<LimitMap> = {};
  for (const key of limitKeys) {
    const v = raw[key];
    if (v === null || (typeof v === 'number' && Number.isInteger(v) && v >= 0)) out[key] = v;
  }
  return out;
}

/** A plan's stored maps, with anything missing or invalid falling back to the safe default. */
export function planMaps(
  features: unknown,
  limits: unknown,
): { features: FeatureMap; limits: LimitMap } {
  return {
    features: { ...DEFAULT_ENTITLEMENTS.features, ...asFeatureOverrides(features) },
    limits: { ...DEFAULT_ENTITLEMENTS.limits, ...asLimitOverrides(limits) },
  };
}

export class ConsoleEntitlementsService {
  constructor(
    private readonly db: Db,
    private readonly signer: Signer,
    private readonly issuer: string,
  ) {}

  /** Plan, then per-customer overrides, then the prerequisite rules. */
  async effective(customerId: string): Promise<EffectiveEntitlements> {
    const row = await this.db.customerEntitlement.findUnique({
      where: { customerId },
      include: { plan: true },
    });
    const base = row?.plan
      ? planMaps(row.plan.features, row.plan.limits)
      : { features: DEFAULT_ENTITLEMENTS.features, limits: DEFAULT_ENTITLEMENTS.limits };
    const features = normaliseFeatures({
      ...base.features,
      ...asFeatureOverrides(row?.featureOverrides),
    });
    const limits: LimitMap = { ...base.limits, ...asLimitOverrides(row?.limitOverrides) };
    return {
      plan: row?.plan ? { id: row.plan.id, name: row.plan.name } : null,
      features,
      limits,
      expiresAt: row?.expiresAt?.toISOString() ?? null,
      priceMonthlyMinor: row?.priceMonthlyMinorOverride ?? row?.plan?.priceMonthlyMinor ?? null,
      currency: row?.plan?.currency ?? 'KES',
    };
  }

  /**
   * Builds the document for one stack. `audience` is what stops a document issued for one
   * customer being replayed onto another's server.
   */
  async documentFor(
    customerId: string,
    stackId: string,
    ownerContact: OwnerContact,
  ): Promise<EntitlementsDocument> {
    const customer = await this.db.customer.findUniqueOrThrow({ where: { id: customerId } });
    const effective = await this.effective(customerId);
    return {
      version: 1,
      customerId: customer.id,
      customerName: customer.name,
      plan: effective.plan ?? { id: 'none', name: 'No plan' },
      features: effective.features,
      limits: effective.limits,
      expiresAt: effective.expiresAt,
      issuedAt: new Date().toISOString(),
      issuer: this.issuer,
      audience: stackId,
      ownerContact,
    };
  }

  /**
   * Signs and records a document for every live stack the customer has. Anything still waiting
   * is marked superseded first: only the newest issue is worth delivering.
   *
   * `issuedById` is null when a script did it rather than an owner, which is the only way the
   * provider's own stack can be served before anybody has an account to sign in with.
   */
  async issue(
    customerId: string,
    issuedById: string | null,
    ownerContact: OwnerContact,
  ): Promise<{ issueId: string; stackId: string; envelope: unknown }[]> {
    const stacks = await this.db.stack.findMany({
      where: { customerId, revokedAt: null },
      select: { id: true },
    });
    const issued: { issueId: string; stackId: string; envelope: unknown }[] = [];
    for (const stack of stacks) {
      const document = await this.documentFor(customerId, stack.id, ownerContact);
      const envelope = this.signer.sign(document);
      const issueId = newIssueId();
      await this.db.$transaction(async (tx) => {
        await tx.entitlementIssue.updateMany({
          where: { stackId: stack.id, status: { in: ['pending', 'delivered'] } },
          data: { status: 'superseded' },
        });
        await tx.entitlementIssue.create({
          data: {
            id: issueId,
            customerId,
            stackId: stack.id,
            envelope,
            payload: document,
            issuedById,
            status: 'pending',
          },
        });
      });
      issued.push({ issueId, stackId: stack.id, envelope });
    }
    return issued;
  }

  /**
   * Suspension with teeth (docs/21 §5). A status column tells the provider something; an expiry of
   * now tells the customer's own server something, because an expired document is already what
   * makes that server refuse every write while leaving everything readable.
   *
   * Whatever the expiry was before is kept, so lifting a suspension puts the customer back where
   * they were rather than handing them an unlimited one. Suspending twice keeps the first record.
   * The caller reissues: this only decides what the next document will say.
   */
  async hold(customerId: string, now = new Date()): Promise<boolean> {
    return this.db.$transaction(async (tx) => {
      const customer = await tx.customer.findUniqueOrThrow({ where: { id: customerId } });
      if (customer.suspendedAt !== null) return false;
      const before = await tx.customerEntitlement.findUnique({ where: { customerId } });
      await tx.customerEntitlement.upsert({
        where: { customerId },
        create: { customerId, expiresAt: now },
        update: { expiresAt: now, expiresAtBeforeSuspension: before?.expiresAt ?? null },
      });
      await tx.customer.update({ where: { id: customerId }, data: { suspendedAt: now } });
      return true;
    });
  }

  /** Gives back exactly the expiry the customer had before, which may itself be in the past. */
  async release(customerId: string): Promise<boolean> {
    return this.db.$transaction(async (tx) => {
      const customer = await tx.customer.findUniqueOrThrow({ where: { id: customerId } });
      if (customer.suspendedAt === null) return false;
      const row = await tx.customerEntitlement.findUnique({ where: { customerId } });
      if (row) {
        await tx.customerEntitlement.update({
          where: { customerId },
          data: { expiresAt: row.expiresAtBeforeSuspension, expiresAtBeforeSuspension: null },
        });
      }
      await tx.customer.update({ where: { id: customerId }, data: { suspendedAt: null } });
      return true;
    });
  }
}

export type { FeatureKey, LimitKey };
