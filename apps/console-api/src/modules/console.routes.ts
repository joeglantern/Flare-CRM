/**
 * Console API (docs/21). Everything an owner does to a customer happens here, and every change
 * is audited. Customer CRM data never passes through: this service knows who the customers are
 * and what they may use, nothing about their contacts or calls.
 */
import { promises as dns } from 'node:dns';
import { randomBytes } from 'node:crypto';
import {
  FEATURES,
  LIMITS,
  dataResponse,
  featureKeys,
  limitKeys,
  normaliseFeatures,
  offsetListResponse,
  ownerContact as ownerContactSchema,
  type OwnerContact,
} from '@crm/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { permissionsFor } from '../auth/permissions.js';
import { auditContext, requireUser } from '../lib/request.js';
import { planMaps } from './entitlements.service.js';

const uuid = z.uuid();
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, 'Letters, numbers and hyphens; 3 to 40 characters');
const hostname = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, 'Expected a hostname');

const featureOverrides = z.object(
  Object.fromEntries(featureKeys.map((k) => [k, z.boolean().optional()])),
);
const limitOverrides = z.object(
  Object.fromEntries(limitKeys.map((k) => [k, z.number().int().min(0).nullable().optional()])),
);

const featureMapFull = z.object(Object.fromEntries(featureKeys.map((k) => [k, z.boolean()])));
const limitMapFull = z.object(
  Object.fromEntries(limitKeys.map((k) => [k, z.number().int().min(0).nullable()])),
);

const customerDto = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  status: z.string(),
  contactName: z.string(),
  contactEmail: z.string(),
  contactPhone: z.string().nullable(),
  notes: z.string(),
  primaryDomain: z.string(),
  customDomain: z.string().nullable(),
  customDomainVerifiedAt: z.string().nullable(),
  /** Set while the provider is holding this customer read only (docs/21 §5). */
  suspendedAt: z.string().nullable(),
  createdAt: z.string(),
});

const planDto = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  features: featureMapFull,
  limits: limitMapFull,
  /** Minor units of `currency`, so 1,500 KES is 150000. Null means this plan is not sold. */
  priceMonthlyMinor: z.number().int().nullable(),
  currency: z.string(),
  isDefault: z.boolean(),
});

/** Money never crosses this boundary as a float. */
const priceMinor = z.number().int().min(0).max(1_000_000_000).nullable();

const ownerDto = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  isActive: z.boolean(),
  twoFactorEnabled: z.boolean(),
  lastSeenAt: z.string().nullable(),
});

const announcementDto = z.object({
  id: z.string(),
  message: z.string(),
  level: z.enum(['info', 'warning', 'error']),
  delivered: z.number().int(),
  sentByName: z.string().nullable(),
  sentAt: z.string(),
});

const stackDto = z.object({
  id: z.string(),
  label: z.string(),
  connected: z.boolean(),
  lastSeenAt: z.string().nullable(),
  version: z.string().nullable(),
  domain: z.string().nullable(),
  lastBackupAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  currentIssueId: z.string().nullable(),
  usage: z.unknown().nullable(),
  health: z.unknown().nullable(),
});

const issueDto = z.object({
  id: z.string(),
  stackId: z.string(),
  status: z.string(),
  issuedAt: z.string(),
  deliveredAt: z.string().nullable(),
  ackedAt: z.string().nullable(),
  rejectReason: z.string().nullable(),
});

// `requires` is readonly in the catalogue; the response shape is a plain array, so it is copied
// rather than the schema being loosened to accept either.
const CATALOGUE = {
  features: featureKeys.map((k) => ({
    key: k,
    label: FEATURES[k].label,
    description: FEATURES[k].description,
    requires: [...FEATURES[k].requires] as string[],
  })),
  limits: limitKeys.map((k) => ({ key: k, ...LIMITS[k] })),
};

/** Owner contact travels inside every issued document, so customers know who to call. */
const OWNER_CONTACT_KEY = 'ownerContact';
const FALLBACK_CONTACT: OwnerContact = { name: 'Your provider', email: 'support@example.com' };

const consoleRoutes: FastifyPluginAsyncZod = async (app) => {
  const ownerContact = async (): Promise<OwnerContact> => {
    const row = await app.db.consoleSetting.findUnique({ where: { key: OWNER_CONTACT_KEY } });
    const parsed = ownerContactSchema.safeParse(row?.value);
    return parsed.success ? parsed.data : FALLBACK_CONTACT;
  };

  const toCustomer = (c: {
    id: string;
    name: string;
    slug: string;
    status: string;
    contactName: string;
    contactEmail: string;
    contactPhone: string | null;
    notes: string;
    primaryDomain: string;
    customDomain: string | null;
    customDomainVerifiedAt: Date | null;
    suspendedAt: Date | null;
    createdAt: Date;
  }) => ({
    ...c,
    customDomainVerifiedAt: c.customDomainVerifiedAt?.toISOString() ?? null,
    suspendedAt: c.suspendedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
  });

  // ── catalogue ────────────────────────────────────────────────────────────────────────
  app.get('/catalogue', {
    config: { auth: { permission: 'plan:read' } },
    schema: {
      tags: ['console'],
      response: {
        200: dataResponse(
          z.object({
            features: z.array(
              z.object({
                key: z.string(),
                label: z.string(),
                description: z.string(),
                requires: z.array(z.string()),
              }),
            ),
            limits: z.array(
              z.object({
                key: z.string(),
                label: z.string(),
                unit: z.string(),
                description: z.string(),
              }),
            ),
          }),
        ),
      },
    },
    handler: () => Promise.resolve({ data: CATALOGUE }),
  });

  // ── customers ────────────────────────────────────────────────────────────────────────
  app.get('/customers', {
    config: { auth: { permission: 'customer:read' } },
    schema: { tags: ['console'], response: { 200: offsetListResponse(customerDto) } },
    handler: async () => {
      const rows = await app.db.customer.findMany({ orderBy: { name: 'asc' } });
      return {
        data: rows.map(toCustomer),
        page: { page: 1, pageSize: rows.length, total: rows.length },
      };
    },
  });

  app.post('/customers', {
    config: { auth: { permission: 'customer:write' } },
    schema: {
      tags: ['console'],
      body: z
        .object({
          name: z.string().trim().min(1).max(200),
          slug,
          contactName: z.string().trim().min(1).max(120),
          contactEmail: z.email().max(254),
          contactPhone: z.string().trim().max(32).optional(),
          notes: z.string().max(4000).default(''),
          planId: uuid.optional(),
        })
        .strict(),
      response: { 201: dataResponse(customerDto) },
    },
    handler: async (request, reply) => {
      const b = request.body;
      const primaryDomain = `${b.slug}.${app.config.CONSOLE_BRAND_DOMAIN}`;
      if (await app.db.customer.findUnique({ where: { slug: b.slug } })) {
        throw new ConflictError('That slug is already taken');
      }
      const plan =
        b.planId !== undefined
          ? await app.db.plan.findUnique({ where: { id: b.planId } })
          : await app.db.plan.findFirst({ where: { isDefault: true } });
      const created = await app.db.customer.create({
        data: {
          id: newId(),
          name: b.name,
          slug: b.slug,
          contactName: b.contactName,
          contactEmail: b.contactEmail,
          contactPhone: b.contactPhone ?? null,
          notes: b.notes,
          primaryDomain,
          entitlement: { create: { planId: plan?.id ?? null } },
        },
      });
      await app.audit.write(auditContext(request), {
        action: 'customer.create',
        entity: 'customer',
        entityId: created.id,
        after: { name: created.name, slug: created.slug, primaryDomain, planId: plan?.id ?? null },
      });
      return reply.status(201).send({ data: toCustomer(created) });
    },
  });

  app.get('/customers/:id', {
    config: { auth: { permission: 'customer:read' } },
    schema: {
      tags: ['console'],
      params: z.object({ id: uuid }),
      response: {
        200: dataResponse(
          z.object({ customer: customerDto, stacks: z.array(stackDto), issues: z.array(issueDto) }),
        ),
      },
    },
    handler: async (request) => {
      const customer = await app.db.customer.findUnique({ where: { id: request.params.id } });
      if (!customer) throw new NotFoundError('Customer');
      const [stacks, issues] = await Promise.all([
        app.db.stack.findMany({
          where: { customerId: customer.id },
          orderBy: { createdAt: 'asc' },
        }),
        app.db.entitlementIssue.findMany({
          where: { customerId: customer.id },
          orderBy: { issuedAt: 'desc' },
          take: 20,
        }),
      ]);
      return {
        data: {
          customer: toCustomer(customer),
          stacks: stacks.map((s) => ({
            id: s.id,
            label: s.label,
            connected: s.connected,
            lastSeenAt: s.lastSeenAt?.toISOString() ?? null,
            version: s.version,
            domain: s.domain,
            lastBackupAt: s.lastBackupAt?.toISOString() ?? null,
            revokedAt: s.revokedAt?.toISOString() ?? null,
            currentIssueId: s.currentIssueId,
            usage: s.usage,
            health: s.health,
          })),
          issues: issues.map((i) => ({
            id: i.id,
            stackId: i.stackId,
            status: i.status,
            issuedAt: i.issuedAt.toISOString(),
            deliveredAt: i.deliveredAt?.toISOString() ?? null,
            ackedAt: i.ackedAt?.toISOString() ?? null,
            rejectReason: i.rejectReason,
          })),
        },
      };
    },
  });

  app.patch('/customers/:id', {
    config: { auth: { permission: 'customer:write' } },
    schema: {
      tags: ['console'],
      params: z.object({ id: uuid }),
      body: z
        .object({
          name: z.string().trim().min(1).max(200).optional(),
          status: z.enum(['active', 'suspended', 'churned']).optional(),
          contactName: z.string().trim().min(1).max(120).optional(),
          contactEmail: z.email().max(254).optional(),
          contactPhone: z.string().trim().max(32).nullable().optional(),
          notes: z.string().max(4000).optional(),
        })
        .strict(),
      response: { 200: dataResponse(customerDto) },
    },
    handler: async (request) => {
      const before = await app.db.customer.findUnique({ where: { id: request.params.id } });
      if (!before) throw new NotFoundError('Customer');
      // exactOptionalPropertyTypes: an absent key and an explicit undefined are different
      // things to Prisma, so only the keys actually sent are passed through.
      const data = Object.fromEntries(
        Object.entries(request.body).filter(([, v]) => v !== undefined),
      );
      await app.db.customer.update({ where: { id: request.params.id }, data });

      // A status is only a word until the customer's own server hears about it. Anything other
      // than active is held read only by an expiry of now, and coming back to active gives back
      // the expiry they had before.
      const status = request.body.status;
      let enforcement: { held: boolean; issues: number } | null = null;
      if (status !== undefined && status !== before.status) {
        const changed =
          status === 'active'
            ? await app.entitlements.release(before.id)
            : await app.entitlements.hold(before.id);
        if (changed) {
          const issued = await app.entitlements.issue(
            before.id,
            requireUser(request).id,
            await ownerContact(),
          );
          await app.link.deliver(issued);
          enforcement = { held: status !== 'active', issues: issued.length };
        }
      }

      const after = await app.db.customer.findUniqueOrThrow({ where: { id: request.params.id } });
      await app.audit.write(auditContext(request), {
        action: 'customer.update',
        entity: 'customer',
        entityId: after.id,
        before: { name: before.name, status: before.status, contactEmail: before.contactEmail },
        after: { ...request.body, ...(enforcement === null ? {} : { enforcement }) },
      });
      return { data: toCustomer(after) };
    },
  });

  // ── the fleet ────────────────────────────────────────────────────────────────────────
  app.get('/fleet', {
    config: { auth: { permission: 'customer:read' } },
    schema: {
      tags: ['console'],
      response: {
        200: dataResponse(
          z.array(
            z.object({
              customer: customerDto,
              plan: z.object({ id: z.string(), name: z.string() }).nullable(),
              expiresAt: z.string().nullable(),
              stacks: z.array(stackDto),
              connected: z.boolean(),
              seats: z.object({ used: z.number().nullable(), max: z.number().nullable() }),
              storageBytes: z.number().nullable(),
              lastSeenAt: z.string().nullable(),
              lastBackupAt: z.string().nullable(),
              version: z.string().nullable(),
            }),
          ),
        ),
      },
    },
    handler: async () => {
      const customers = await app.db.customer.findMany({
        orderBy: { name: 'asc' },
        include: { stacks: { orderBy: { createdAt: 'asc' } } },
      });
      const rows = [];
      for (const c of customers) {
        const effective = await app.entitlements.effective(c.id);
        const live = c.stacks.filter((s) => s.revokedAt === null);
        const newest = live.find((s) => s.connected) ?? live[0];
        const usage = (newest?.usage ?? null) as {
          seatsActive?: number;
          storageBytes?: number;
        } | null;
        rows.push({
          customer: toCustomer(c),
          plan: effective.plan,
          expiresAt: effective.expiresAt,
          stacks: live.map((s) => ({
            id: s.id,
            label: s.label,
            connected: s.connected,
            lastSeenAt: s.lastSeenAt?.toISOString() ?? null,
            version: s.version,
            domain: s.domain,
            lastBackupAt: s.lastBackupAt?.toISOString() ?? null,
            revokedAt: null,
            currentIssueId: s.currentIssueId,
            usage: s.usage,
            health: s.health,
          })),
          connected: live.some((s) => s.connected),
          seats: { used: usage?.seatsActive ?? null, max: effective.limits.seats },
          storageBytes: usage?.storageBytes ?? null,
          lastSeenAt: newest?.lastSeenAt?.toISOString() ?? null,
          lastBackupAt: newest?.lastBackupAt?.toISOString() ?? null,
          version: newest?.version ?? null,
        });
      }
      return { data: rows };
    },
  });

  // ── plans ────────────────────────────────────────────────────────────────────────────
  app.get('/plans', {
    config: { auth: { permission: 'plan:read' } },
    schema: { tags: ['console'], response: { 200: offsetListResponse(planDto) } },
    handler: async () => {
      const rows = await app.db.plan.findMany({ orderBy: { name: 'asc' } });
      const data = rows.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        priceMonthlyMinor: p.priceMonthlyMinor,
        currency: p.currency,
        isDefault: p.isDefault,
        ...planMaps(p.features, p.limits),
      }));
      return { data, page: { page: 1, pageSize: data.length, total: data.length } };
    },
  });

  app.post('/plans', {
    config: { auth: { permission: 'plan:write' } },
    schema: {
      tags: ['console'],
      body: z
        .object({
          name: z.string().trim().min(1).max(80),
          description: z.string().max(2000).default(''),
          features: featureOverrides.default({}),
          limits: limitOverrides.default({}),
          priceMonthlyMinor: priceMinor.default(null),
          currency: z.string().trim().length(3).toUpperCase().default('KES'),
          isDefault: z.boolean().default(false),
        })
        .strict(),
      response: { 201: dataResponse(planDto) },
    },
    handler: async (request, reply) => {
      const b = request.body;
      const maps = planMaps(b.features, b.limits);
      maps.features = normaliseFeatures(maps.features);
      const created = await app.db.$transaction(async (tx) => {
        if (b.isDefault) await tx.plan.updateMany({ data: { isDefault: false } });
        return tx.plan.create({
          data: {
            id: newId(),
            name: b.name,
            description: b.description,
            features: maps.features,
            limits: maps.limits,
            priceMonthlyMinor: b.priceMonthlyMinor,
            currency: b.currency,
            isDefault: b.isDefault,
          },
        });
      });
      await app.audit.write(auditContext(request), {
        action: 'plan.create',
        entity: 'plan',
        entityId: created.id,
        after: { name: created.name, price: created.priceMonthlyMinor, ...maps },
      });
      return reply.status(201).send({
        data: {
          id: created.id,
          name: created.name,
          description: created.description,
          priceMonthlyMinor: created.priceMonthlyMinor,
          currency: created.currency,
          isDefault: created.isDefault,
          ...maps,
        },
      });
    },
  });

  app.patch('/plans/:id', {
    config: { auth: { permission: 'plan:write' } },
    schema: {
      tags: ['console'],
      params: z.object({ id: uuid }),
      body: z
        .object({
          name: z.string().trim().min(1).max(80).optional(),
          description: z.string().max(2000).optional(),
          features: featureOverrides.optional(),
          limits: limitOverrides.optional(),
          priceMonthlyMinor: priceMinor.optional(),
          currency: z.string().trim().length(3).toUpperCase().optional(),
          isDefault: z.boolean().optional(),
        })
        .strict(),
      response: { 200: dataResponse(planDto) },
    },
    handler: async (request) => {
      const before = await app.db.plan.findUnique({ where: { id: request.params.id } });
      if (!before) throw new NotFoundError('Plan');
      const b = request.body;
      const current = planMaps(before.features, before.limits);
      const maps = {
        features: normaliseFeatures({ ...current.features, ...(b.features ?? {}) }),
        limits: { ...current.limits, ...(b.limits ?? {}) },
      };
      const updated = await app.db.$transaction(async (tx) => {
        if (b.isDefault === true) await tx.plan.updateMany({ data: { isDefault: false } });
        return tx.plan.update({
          where: { id: request.params.id },
          data: {
            ...(b.name !== undefined ? { name: b.name } : {}),
            ...(b.description !== undefined ? { description: b.description } : {}),
            ...(b.isDefault !== undefined ? { isDefault: b.isDefault } : {}),
            ...(b.priceMonthlyMinor !== undefined
              ? { priceMonthlyMinor: b.priceMonthlyMinor }
              : {}),
            ...(b.currency !== undefined ? { currency: b.currency } : {}),
            features: maps.features,
            limits: maps.limits,
          },
        });
      });
      await app.audit.write(auditContext(request), {
        action: 'plan.update',
        entity: 'plan',
        entityId: updated.id,
        before: { name: before.name, price: before.priceMonthlyMinor, ...current },
        after: { name: updated.name, price: updated.priceMonthlyMinor, ...maps },
      });
      return {
        data: {
          id: updated.id,
          name: updated.name,
          description: updated.description,
          priceMonthlyMinor: updated.priceMonthlyMinor,
          currency: updated.currency,
          isDefault: updated.isDefault,
          ...maps,
        },
      };
    },
  });

  app.delete('/plans/:id', {
    config: { auth: { permission: 'plan:write' } },
    schema: { tags: ['console'], params: z.object({ id: uuid }), response: { 204: z.null() } },
    handler: async (request, reply) => {
      const inUse = await app.db.customerEntitlement.count({
        where: { planId: request.params.id },
      });
      if (inUse > 0) {
        throw new ConflictError(
          `${String(inUse)} customer${inUse === 1 ? '' : 's'} are on this plan; move them first`,
        );
      }
      await app.db.plan.delete({ where: { id: request.params.id } });
      await app.audit.write(auditContext(request), {
        action: 'plan.delete',
        entity: 'plan',
        entityId: request.params.id,
      });
      return reply.status(204).send(null);
    },
  });

  // ── entitlements ─────────────────────────────────────────────────────────────────────
  app.get('/customers/:id/entitlements', {
    config: { auth: { permission: 'entitlement:read' } },
    schema: {
      tags: ['console'],
      params: z.object({ id: uuid }),
      response: {
        200: dataResponse(
          z.object({
            planId: z.string().nullable(),
            featureOverrides: z.record(z.string(), z.boolean()),
            limitOverrides: z.record(z.string(), z.number().nullable()),
            expiresAt: z.string().nullable(),
            priceMonthlyMinorOverride: z.number().int().nullable(),
            agreementNotes: z.string(),
            effective: z.object({
              plan: z.object({ id: z.string(), name: z.string() }).nullable(),
              features: featureMapFull,
              limits: limitMapFull,
              expiresAt: z.string().nullable(),
              /** What this customer is billed: their override, or the plan's price. */
              priceMonthlyMinor: z.number().int().nullable(),
              currency: z.string(),
            }),
          }),
        ),
      },
    },
    handler: async (request) => {
      const row = await app.db.customerEntitlement.findUnique({
        where: { customerId: request.params.id },
      });
      if (!row) throw new NotFoundError('Customer');
      return {
        data: {
          planId: row.planId,
          featureOverrides: (row.featureOverrides ?? {}) as Record<string, boolean>,
          limitOverrides: (row.limitOverrides ?? {}) as Record<string, number | null>,
          expiresAt: row.expiresAt?.toISOString() ?? null,
          priceMonthlyMinorOverride: row.priceMonthlyMinorOverride,
          agreementNotes: row.agreementNotes,
          effective: await app.entitlements.effective(request.params.id),
        },
      };
    },
  });

  app.put('/customers/:id/entitlements', {
    config: { auth: { permission: 'entitlement:issue' } },
    schema: {
      tags: ['console'],
      params: z.object({ id: uuid }),
      body: z
        .object({
          planId: uuid.nullable().optional(),
          featureOverrides: featureOverrides.optional(),
          limitOverrides: limitOverrides.optional(),
          expiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
          priceMonthlyMinorOverride: priceMinor.optional(),
          agreementNotes: z.string().max(4000).optional(),
        })
        .strict(),
      response: { 200: dataResponse(z.object({ ok: z.literal(true) })) },
    },
    handler: async (request) => {
      const b = request.body;
      const before = await app.db.customerEntitlement.findUnique({
        where: { customerId: request.params.id },
      });
      if (!before) throw new NotFoundError('Customer');
      await app.db.customerEntitlement.update({
        where: { customerId: request.params.id },
        data: {
          ...(b.planId !== undefined ? { planId: b.planId } : {}),
          ...(b.featureOverrides !== undefined ? { featureOverrides: b.featureOverrides } : {}),
          ...(b.limitOverrides !== undefined ? { limitOverrides: b.limitOverrides } : {}),
          ...(b.expiresAt !== undefined
            ? { expiresAt: b.expiresAt === null ? null : new Date(b.expiresAt) }
            : {}),
          ...(b.priceMonthlyMinorOverride !== undefined
            ? { priceMonthlyMinorOverride: b.priceMonthlyMinorOverride }
            : {}),
          ...(b.agreementNotes !== undefined ? { agreementNotes: b.agreementNotes } : {}),
          updatedById: requireUser(request).id,
        },
      });
      await app.audit.write(auditContext(request), {
        action: 'entitlement.update',
        entity: 'customer',
        entityId: request.params.id,
        before: {
          planId: before.planId,
          featureOverrides: before.featureOverrides,
          limitOverrides: before.limitOverrides,
          expiresAt: before.expiresAt,
        },
        after: b,
      });
      return { data: { ok: true as const } };
    },
  });

  app.post('/customers/:id/issue', {
    config: { auth: { permission: 'entitlement:issue' } },
    schema: {
      tags: ['console'],
      params: z.object({ id: uuid }),
      response: { 200: dataResponse(z.object({ issues: z.array(issueDto) })) },
    },
    handler: async (request) => {
      const customer = await app.db.customer.findUnique({ where: { id: request.params.id } });
      if (!customer) throw new NotFoundError('Customer');
      const issued = await app.entitlements.issue(
        customer.id,
        requireUser(request).id,
        await ownerContact(),
      );
      if (issued.length === 0) {
        throw new ConflictError('This customer has no stack registered yet');
      }
      await app.link.deliver(issued);
      await app.audit.write(auditContext(request), {
        action: 'entitlement.issue',
        entity: 'customer',
        entityId: customer.id,
        after: { issues: issued.map((i) => ({ issueId: i.issueId, stackId: i.stackId })) },
      });
      const rows = await app.db.entitlementIssue.findMany({
        where: { id: { in: issued.map((i) => i.issueId) } },
      });
      return {
        data: {
          issues: rows.map((i) => ({
            id: i.id,
            stackId: i.stackId,
            status: i.status,
            issuedAt: i.issuedAt.toISOString(),
            deliveredAt: i.deliveredAt?.toISOString() ?? null,
            ackedAt: i.ackedAt?.toISOString() ?? null,
            rejectReason: i.rejectReason,
          })),
        },
      };
    },
  });

  // ── stacks ───────────────────────────────────────────────────────────────────────────
  app.post('/customers/:id/stacks', {
    config: { auth: { permission: 'stack:manage' } },
    schema: {
      tags: ['console'],
      params: z.object({ id: uuid }),
      body: z.object({ label: z.string().trim().min(1).max(40).default('primary') }).strict(),
      response: {
        201: dataResponse(
          z.object({ stackId: z.string(), secret: z.string(), envLines: z.array(z.string()) }),
        ),
      },
    },
    handler: async (request, reply) => {
      const customer = await app.db.customer.findUnique({ where: { id: request.params.id } });
      if (!customer) throw new NotFoundError('Customer');
      const created = await app.stacks.create(customer.id, request.body.label);
      await app.audit.write(auditContext(request), {
        action: 'stack.create',
        entity: 'stack',
        entityId: created.stackId,
        after: { customerId: customer.id, label: request.body.label },
      });
      // The secret is in this response and nowhere else, by design.
      return reply.status(201).send({ data: created });
    },
  });

  app.post('/stacks/:stackId/rotate', {
    config: { auth: { permission: 'stack:manage' } },
    schema: {
      tags: ['console'],
      params: z.object({ stackId: z.string().min(4).max(64) }),
      response: {
        200: dataResponse(
          z.object({ stackId: z.string(), secret: z.string(), envLines: z.array(z.string()) }),
        ),
      },
    },
    handler: async (request) => {
      const stack = await app.db.stack.findUnique({ where: { id: request.params.stackId } });
      if (!stack) throw new NotFoundError('Stack');
      const rotated = await app.stacks.rotate(stack.id);
      app.link.disconnect(stack.id);
      await app.audit.write(auditContext(request), {
        action: 'stack.rotate',
        entity: 'stack',
        entityId: stack.id,
      });
      return { data: rotated };
    },
  });

  app.post('/stacks/:stackId/ping', {
    config: { auth: { permission: 'stack:read' } },
    schema: {
      tags: ['console'],
      params: z.object({ stackId: z.string().min(4).max(64) }),
      response: { 200: dataResponse(z.object({ asked: z.boolean() })) },
    },
    handler: (request) => {
      // No audit row: asking a stack to speak sooner changes nothing about it.
      return Promise.resolve({ data: { asked: app.link.ping(request.params.stackId) } });
    },
  });

  app.delete('/stacks/:stackId', {
    config: { auth: { permission: 'stack:manage' } },
    schema: {
      tags: ['console'],
      params: z.object({ stackId: z.string().min(4).max(64) }),
      response: { 204: z.null() },
    },
    handler: async (request, reply) => {
      const stack = await app.db.stack.findUnique({ where: { id: request.params.stackId } });
      if (!stack) throw new NotFoundError('Stack');
      await app.stacks.revoke(stack.id);
      app.link.disconnect(stack.id);
      await app.audit.write(auditContext(request), {
        action: 'stack.revoke',
        entity: 'stack',
        entityId: stack.id,
      });
      return reply.status(204).send(null);
    },
  });

  // ── domains ──────────────────────────────────────────────────────────────────────────
  app.put('/customers/:id/domain', {
    config: { auth: { permission: 'customer:write' } },
    schema: {
      tags: ['console'],
      params: z.object({ id: uuid }),
      body: z.object({ customDomain: hostname.nullable() }).strict(),
      response: {
        200: dataResponse(
          z.object({
            customDomain: z.string().nullable(),
            cnameTarget: z.string(),
            txtName: z.string().nullable(),
            txtValue: z.string().nullable(),
          }),
        ),
      },
    },
    handler: async (request) => {
      const customer = await app.db.customer.findUnique({ where: { id: request.params.id } });
      if (!customer) throw new NotFoundError('Customer');
      const domain = request.body.customDomain;
      const token = domain === null ? null : randomBytes(24).toString('base64url');
      await app.db.customer.update({
        where: { id: customer.id },
        data: {
          customDomain: domain,
          customDomainToken: token,
          customDomainVerifiedAt: null,
        },
      });
      await app.audit.write(auditContext(request), {
        action: 'customer.domain_set',
        entity: 'customer',
        entityId: customer.id,
        before: { customDomain: customer.customDomain },
        after: { customDomain: domain },
      });
      return {
        data: {
          customDomain: domain,
          cnameTarget: customer.primaryDomain,
          txtName: domain === null ? null : `_flare-verify.${domain}`,
          txtValue: token,
        },
      };
    },
  });

  app.post('/customers/:id/domain/verify', {
    config: { auth: { permission: 'customer:write' } },
    schema: {
      tags: ['console'],
      params: z.object({ id: uuid }),
      response: {
        200: dataResponse(
          z.object({
            verified: z.boolean(),
            cname: z.object({ ok: z.boolean(), found: z.array(z.string()) }),
            txt: z.object({ ok: z.boolean() }),
            primaryResolves: z.object({ ok: z.boolean(), addresses: z.array(z.string()) }),
          }),
        ),
      },
    },
    handler: async (request) => {
      const customer = await app.db.customer.findUnique({ where: { id: request.params.id } });
      if (!customer) throw new NotFoundError('Customer');
      if (customer.customDomain === null || customer.customDomainToken === null) {
        throw new ConflictError('No custom domain has been set for this customer');
      }
      const resolver = app.dnsResolver;
      const [cnames, txts, addresses] = await Promise.all([
        resolver.resolveCname(customer.customDomain).catch(() => [] as string[]),
        resolver.resolveTxt(`_flare-verify.${customer.customDomain}`).catch(() => [] as string[][]),
        resolver.resolve4(customer.primaryDomain).catch(() => [] as string[]),
      ]);
      const cnameOk = cnames.some((c) => c.replace(/\.$/, '') === customer.primaryDomain);
      const txtOk = txts.flat().includes(customer.customDomainToken);
      const verified = cnameOk && txtOk;
      if (verified) {
        await app.db.customer.update({
          where: { id: customer.id },
          data: { customDomainVerifiedAt: new Date() },
        });
        await app.audit.write(auditContext(request), {
          action: 'customer.domain_verified',
          entity: 'customer',
          entityId: customer.id,
          after: { customDomain: customer.customDomain },
        });
      }
      return {
        data: {
          verified,
          cname: { ok: cnameOk, found: cnames },
          txt: { ok: txtOk },
          primaryResolves: { ok: addresses.length > 0, addresses },
        },
      };
    },
  });

  // ── announcements ────────────────────────────────────────────────────────────────────
  app.post('/customers/:id/announce', {
    config: { auth: { permission: 'announce:send' } },
    schema: {
      tags: ['console'],
      params: z.object({ id: uuid }),
      body: z
        .object({
          message: z.string().trim().min(1).max(500),
          level: z.enum(['info', 'warning', 'error']).default('info'),
        })
        .strict(),
      response: { 200: dataResponse(z.object({ delivered: z.number().int() })) },
    },
    handler: async (request) => {
      const stacks = await app.db.stack.findMany({
        where: { customerId: request.params.id, revokedAt: null, connected: true },
        select: { id: true },
      });
      if (stacks.length === 0) {
        throw new ConflictError('None of this customer’s stacks are connected right now');
      }
      const delivered = app.link.announce(
        stacks.map((s) => s.id),
        request.body,
      );
      await app.db.announcement.create({
        data: {
          id: newId(),
          customerId: request.params.id,
          message: request.body.message,
          level: request.body.level,
          delivered,
          sentById: requireUser(request).id,
        },
      });
      await app.audit.write(auditContext(request), {
        action: 'customer.announce',
        entity: 'customer',
        entityId: request.params.id,
        after: { ...request.body, delivered },
      });
      return { data: { delivered } };
    },
  });

  app.get('/customers/:id/announcements', {
    config: { auth: { permission: 'customer:read' } },
    schema: {
      tags: ['console'],
      params: z.object({ id: uuid }),
      response: { 200: offsetListResponse(announcementDto) },
    },
    handler: async (request) => {
      const rows = await app.db.announcement.findMany({
        where: { customerId: request.params.id },
        orderBy: { sentAt: 'desc' },
        take: 50,
      });
      const senders = await app.db.user.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.sentById))] } },
        select: { id: true, name: true },
      });
      const byId = new Map(senders.map((u) => [u.id, u.name]));
      const data = rows.map((r) => ({
        id: r.id,
        message: r.message,
        level: r.level as 'info' | 'warning' | 'error',
        delivered: r.delivered,
        sentByName: byId.get(r.sentById) ?? null,
        sentAt: r.sentAt.toISOString(),
      }));
      return { data, page: { page: 1, pageSize: data.length, total: data.length } };
    },
  });

  // ── support: reaching into a customer's own CRM, at their request (docs/21 §9) ────────
  app.post('/customers/:id/support/list-users', {
    config: { auth: { permission: 'support:run' } },
    schema: {
      tags: ['console'],
      params: z.object({ id: uuid }),
      response: {
        200: dataResponse(
          z.object({
            stackId: z.string(),
            users: z.array(
              z.object({
                id: z.string(),
                name: z.string(),
                email: z.string(),
                role: z.string(),
                isActive: z.boolean(),
                twoFactorEnabled: z.boolean(),
                lastSeenAt: z.string().nullable(),
              }),
            ),
          }),
        ),
      },
    },
    handler: async (request) => {
      const actor = requireUser(request);
      const outcome = await app.support.run(
        { customerId: request.params.id, action: 'list-users', requestedBy: actor.email },
        auditContext(request),
      );
      if (!outcome.ok) throw new ConflictError(outcome.message ?? 'The stack could not answer');
      return { data: { stackId: outcome.stackId, users: outcome.users } };
    },
  });

  app.post('/customers/:id/support/reset-two-factor', {
    config: { auth: { permission: 'support:run' } },
    schema: {
      tags: ['console'],
      params: z.object({ id: uuid }),
      body: z
        .object({ email: z.email().max(254), reason: z.string().trim().max(300).optional() })
        .strict(),
      response: { 200: dataResponse(z.object({ ok: z.literal(true), message: z.string() })) },
    },
    handler: async (request) => {
      const actor = requireUser(request);
      const outcome = await app.support.run(
        {
          customerId: request.params.id,
          action: 'reset-two-factor',
          email: request.body.email,
          ...(request.body.reason === undefined ? {} : { reason: request.body.reason }),
          requestedBy: actor.email,
        },
        auditContext(request),
      );
      if (!outcome.ok) throw new ConflictError(outcome.message ?? 'The stack refused that');
      return {
        data: {
          ok: true as const,
          message:
            outcome.message ?? 'They can set up an authenticator again at their next sign-in.',
        },
      };
    },
  });

  app.post('/customers/:id/support/revoke-sessions', {
    config: { auth: { permission: 'support:run' } },
    schema: {
      tags: ['console'],
      params: z.object({ id: uuid }),
      body: z
        .object({ email: z.email().max(254), reason: z.string().trim().max(300).optional() })
        .strict(),
      response: { 200: dataResponse(z.object({ ok: z.literal(true), message: z.string() })) },
    },
    handler: async (request) => {
      const actor = requireUser(request);
      const outcome = await app.support.run(
        {
          customerId: request.params.id,
          action: 'revoke-sessions',
          email: request.body.email,
          ...(request.body.reason === undefined ? {} : { reason: request.body.reason }),
          requestedBy: actor.email,
        },
        auditContext(request),
      );
      if (!outcome.ok) throw new ConflictError(outcome.message ?? 'The stack refused that');
      return {
        data: {
          ok: true as const,
          message: outcome.message ?? 'They have been signed out everywhere.',
        },
      };
    },
  });

  // ── who am I ─────────────────────────────────────────────────────────────────────────
  // Reachable before two-factor is set up: the console has to be able to tell a new owner that
  // setting it up is the only thing they can do.
  app.get('/me', {
    config: { auth: { authenticated: true, allowWithout2FA: true } },
    schema: {
      tags: ['console'],
      response: {
        200: dataResponse(
          z.object({
            id: z.string(),
            name: z.string(),
            email: z.string(),
            role: z.string(),
            twoFactorEnabled: z.boolean(),
            permissions: z.array(z.string()),
          }),
        ),
      },
    },
    handler: (request) => {
      const user = requireUser(request);
      const role = user.role ?? 'owner';
      return Promise.resolve({
        data: {
          id: user.id,
          name: user.name,
          email: user.email,
          role,
          twoFactorEnabled: user.twoFactorEnabled === true,
          permissions: permissionsFor(role),
        },
      });
    },
  });

  // ── owners ───────────────────────────────────────────────────────────────────────────
  app.get('/owners', {
    config: { auth: { permission: 'owner:manage' } },
    schema: {
      tags: ['console'],
      response: {
        200: offsetListResponse(
          z.object({
            id: z.string(),
            name: z.string(),
            email: z.string(),
            isActive: z.boolean(),
            twoFactorEnabled: z.boolean(),
            lastSeenAt: z.string().nullable(),
          }),
        ),
      },
    },
    handler: async () => {
      const rows = await app.db.user.findMany({ orderBy: { name: 'asc' } });
      const data = rows.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        isActive: u.isActive,
        twoFactorEnabled: u.twoFactorEnabled === true,
        lastSeenAt: u.lastSeenAt?.toISOString() ?? null,
      }));
      return { data, page: { page: 1, pageSize: data.length, total: data.length } };
    },
  });

  app.post('/owners', {
    config: { auth: { permission: 'owner:manage' } },
    schema: {
      tags: ['console'],
      body: z
        .object({ name: z.string().trim().min(1).max(120), email: z.email().max(254) })
        .strict(),
      response: { 201: dataResponse(z.object({ id: z.string() })) },
    },
    handler: async (request, reply) => {
      const { name, email } = request.body;
      if (await app.db.user.findUnique({ where: { email } })) {
        throw new ConflictError('An owner with this email already exists');
      }
      const created = await app.inviteOwner(name, email, request.headers);
      await app.audit.write(auditContext(request), {
        action: 'owner.create',
        entity: 'owner',
        entityId: created.id,
        after: { name, email },
      });
      return reply.status(201).send({ data: { id: created.id } });
    },
  });

  app.post('/owners/:id/deactivate', {
    config: { auth: { permission: 'owner:manage' } },
    schema: {
      tags: ['console'],
      params: z.object({ id: uuid }),
      response: { 200: dataResponse(ownerDto) },
    },
    handler: async (request) => ({
      data: await app.owners.setActive(
        request.params.id,
        false,
        requireUser(request).id,
        auditContext(request),
      ),
    }),
  });

  app.post('/owners/:id/reactivate', {
    config: { auth: { permission: 'owner:manage' } },
    schema: {
      tags: ['console'],
      params: z.object({ id: uuid }),
      response: { 200: dataResponse(ownerDto) },
    },
    handler: async (request) => ({
      data: await app.owners.setActive(
        request.params.id,
        true,
        requireUser(request).id,
        auditContext(request),
      ),
    }),
  });

  /**
   * The way back in for an owner who has lost their phone and their backup codes. There is nobody
   * above an owner here, so without this the account is gone for good.
   */
  app.post('/owners/:id/two-factor/reset', {
    config: { auth: { permission: 'owner:manage' } },
    schema: {
      tags: ['console'],
      params: z.object({ id: uuid }),
      response: { 200: dataResponse(ownerDto) },
    },
    handler: async (request) => ({
      data: await app.owners.resetTwoFactor(
        request.params.id,
        request.headers,
        auditContext(request),
      ),
    }),
  });

  /**
   * The way back in for an owner who has forgotten their password. It sends a link rather than
   * setting one: nobody here, including the other owner, ever knows somebody else's password.
   */
  app.post('/owners/:id/password-reset', {
    config: { auth: { permission: 'owner:manage' } },
    schema: {
      tags: ['console'],
      params: z.object({ id: uuid }),
      response: { 200: dataResponse(ownerDto) },
    },
    handler: async (request) => ({
      data: await app.owners.sendPasswordReset(request.params.id, auditContext(request)),
    }),
  });

  app.post('/owners/:id/revoke-sessions', {
    config: { auth: { permission: 'owner:manage' } },
    schema: {
      tags: ['console'],
      params: z.object({ id: uuid }),
      response: { 200: dataResponse(ownerDto) },
    },
    handler: async (request) => ({
      data: await app.owners.revokeSessions(
        request.params.id,
        request.headers,
        auditContext(request),
      ),
    }),
  });

  // ── settings and audit ───────────────────────────────────────────────────────────────
  app.get('/console/settings', {
    config: { auth: { permission: 'settings:read' } },
    schema: {
      tags: ['console'],
      response: {
        200: dataResponse(
          z.object({
            brandDomain: z.string(),
            consoleUrl: z.string(),
            ownerContact: ownerContactSchema,
            signingKey: z.object({
              keyId: z.string(),
              publicKeySpkiBase64: z.string(),
              algorithm: z.literal('Ed25519'),
            }),
          }),
        ),
      },
    },
    handler: async () => ({
      data: {
        brandDomain: app.config.CONSOLE_BRAND_DOMAIN,
        consoleUrl: app.config.CONSOLE_URL,
        ownerContact: await ownerContact(),
        signingKey: {
          keyId: app.signer.keyId,
          publicKeySpkiBase64: app.signer.publicKeySpkiBase64,
          algorithm: 'Ed25519' as const,
        },
      },
    }),
  });

  app.put('/console/settings', {
    config: { auth: { permission: 'settings:manage' } },
    schema: {
      tags: ['console'],
      body: z.object({ ownerContact: ownerContactSchema }).strict(),
      response: { 200: dataResponse(z.object({ ok: z.literal(true) })) },
    },
    handler: async (request) => {
      const before = await ownerContact();
      await app.db.consoleSetting.upsert({
        where: { key: OWNER_CONTACT_KEY },
        create: { key: OWNER_CONTACT_KEY, value: request.body.ownerContact },
        update: { value: request.body.ownerContact },
      });
      await app.audit.write(auditContext(request), {
        action: 'settings.update',
        entity: 'settings',
        before,
        after: request.body.ownerContact,
      });
      return { data: { ok: true as const } };
    },
  });

  app.get('/audit', {
    config: { auth: { permission: 'audit:read' } },
    schema: {
      tags: ['console'],
      querystring: z.object({
        entityId: z.string().max(80).optional(),
        action: z.string().max(80).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(50),
      }),
      response: {
        200: offsetListResponse(
          z.object({
            id: z.string(),
            actorId: z.string().nullable(),
            actorName: z.string().nullable(),
            actorType: z.string(),
            action: z.string(),
            entity: z.string(),
            entityId: z.string().nullable(),
            before: z.unknown().nullable(),
            after: z.unknown().nullable(),
            createdAt: z.string(),
          }),
        ),
      },
    },
    handler: async (request) => {
      const q = request.query;
      const where = {
        ...(q.entityId !== undefined ? { entityId: q.entityId } : {}),
        ...(q.action !== undefined ? { action: { startsWith: q.action } } : {}),
      };
      const [rows, total] = await Promise.all([
        app.db.auditLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        app.db.auditLog.count({ where }),
      ]);
      const actorIds = [...new Set(rows.map((r) => r.actorId).filter((id) => id !== null))];
      const actors =
        actorIds.length > 0
          ? await app.db.user.findMany({
              where: { id: { in: actorIds } },
              select: { id: true, name: true },
            })
          : [];
      const byId = new Map(actors.map((a) => [a.id, a.name]));
      return {
        data: rows.map((r) => ({
          id: r.id,
          actorId: r.actorId,
          actorName: r.actorId === null ? null : (byId.get(r.actorId) ?? null),
          actorType: r.actorType,
          action: r.action,
          entity: r.entity,
          entityId: r.entityId,
          before: r.before ?? null,
          after: r.after ?? null,
          createdAt: r.createdAt.toISOString(),
        })),
        page: { page: q.page, pageSize: q.pageSize, total },
      };
    },
  });
};

export default consoleRoutes;
export { dns };
