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
   */
  async issue(
    customerId: string,
    issuedById: string,
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
}

export type { FeatureKey, LimitKey };
