import { z } from 'zod';
import { DealStatus, valuesOf } from '../enums.js';
import { isoDate, isoDateTime, paginationOffset, sortParam, uuid } from './common.js';
import { companyRef, userRef } from './company.js';
import { customFieldsInput } from './custom-field.js';

export const dealStageRef = z.object({
  id: uuid,
  name: z.string(),
  type: z.string(),
  probability: z.number().int(),
});

export const dealDto = z.object({
  id: uuid,
  title: z.string(),
  contact: z.object({ id: uuid, displayName: z.string() }).nullable(),
  contactId: uuid.nullable(),
  company: companyRef.nullable(),
  companyId: uuid.nullable(),
  pipelineId: uuid,
  stage: dealStageRef,
  stageId: uuid,
  value: z.number(),
  currency: z.string(),
  probability: z.number().int(),
  weightedValue: z.number(),
  expectedCloseDate: isoDate.nullable(),
  owner: userRef.nullable(),
  ownerId: uuid.nullable(),
  status: z.enum(valuesOf(DealStatus)),
  wonAt: isoDateTime.nullable(),
  lostAt: isoDateTime.nullable(),
  lostReason: z.string().nullable(),
  customFields: z.record(z.string(), z.unknown()),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  deletedAt: isoDateTime.nullable(),
});
export type DealDto = z.infer<typeof dealDto>;

const money = z.number().min(0).max(999_999_999_999.99);

export const createDealBody = z
  .object({
    title: z.string().trim().min(1).max(200),
    contactId: uuid.nullable().optional(),
    companyId: uuid.nullable().optional(),
    pipelineId: uuid.optional(),
    stageId: uuid.optional(),
    value: money.default(0),
    currency: z.string().length(3).toUpperCase().optional(),
    probability: z.number().int().min(0).max(100).optional(),
    expectedCloseDate: isoDate.nullable().optional(),
    ownerId: uuid.nullable().optional(),
    customFields: customFieldsInput.optional(),
  })
  .strict();
export type CreateDealBody = z.infer<typeof createDealBody>;

export const updateDealBody = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    contactId: uuid.nullable().optional(),
    companyId: uuid.nullable().optional(),
    value: money.optional(),
    currency: z.string().length(3).toUpperCase().optional(),
    probability: z.number().int().min(0).max(100).optional(),
    expectedCloseDate: isoDate.nullable().optional(),
    ownerId: uuid.nullable().optional(),
    customFields: customFieldsInput.optional(),
    expectedUpdatedAt: isoDateTime.optional(),
  })
  .strict();
export type UpdateDealBody = z.infer<typeof updateDealBody>;

export const changeStageBody = z
  .object({
    stageId: uuid,
    lostReason: z.string().trim().max(300).optional(),
    expectedUpdatedAt: isoDateTime.optional(),
  })
  .strict();

export const DEAL_SORT = ['title', 'value', 'expectedCloseDate', 'createdAt', 'updatedAt'] as const;
export const listDealsQuery = paginationOffset.extend({
  q: z.string().trim().max(120).optional(),
  pipelineId: uuid.optional(),
  stageId: uuid.optional(),
  ownerId: uuid.optional(),
  contactId: uuid.optional(),
  companyId: uuid.optional(),
  status: z.enum(valuesOf(DealStatus)).optional(),
  closeFrom: isoDate.optional(),
  closeTo: isoDate.optional(),
  sort: sortParam(DEAL_SORT),
});

export const boardQuery = z.object({ pipelineId: uuid.optional(), ownerId: uuid.optional() });

export const boardColumn = z.object({
  stage: dealStageRef.extend({ sortOrder: z.number().int() }),
  deals: z.array(dealDto),
  totalValue: z.number(),
  count: z.number().int(),
});

export const dealStageHistoryDto = z.object({
  id: uuid,
  fromStage: z.object({ id: uuid, name: z.string() }).nullable(),
  toStage: z.object({ id: uuid, name: z.string() }),
  changedBy: userRef.nullable(),
  changedAt: isoDateTime,
});

export const bulkDealsBody = z
  .object({
    action: z.enum(['assign', 'delete', 'stage']),
    ids: z.array(uuid).min(1).max(500),
    ownerId: uuid.nullable().optional(),
    stageId: uuid.optional(),
  })
  .strict();
