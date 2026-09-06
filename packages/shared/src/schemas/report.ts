import { z } from 'zod';
import { isoDate, isoDateTime, paginationOffset, uuid } from './common.js';

const range = z.object({
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  /** IANA zone used for daily buckets; defaults to the caller's profile timezone. */
  tz: z.string().max(64).optional(),
  format: z.enum(['json', 'csv']).default('json'),
});

export const callsReportQuery = range.extend({ userId: uuid.optional(), teamId: uuid.optional() });
export const missedCallsQuery = paginationOffset.extend({
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  format: z.enum(['json', 'csv']).default('json'),
});

export const callsSummaryDto = z.object({
  from: isoDateTime,
  to: isoDateTime,
  totals: z.object({
    calls: z.number().int(),
    inbound: z.number().int(),
    outbound: z.number().int(),
    internal: z.number().int(),
    answered: z.number().int(),
    missed: z.number().int(),
    abandoned: z.number().int(),
    busy: z.number().int(),
    voicemail: z.number().int(),
    failed: z.number().int(),
  }),
  answerRate: z.number(),
  avgTalkSec: z.number(),
  avgRingSec: z.number(),
  totalTalkSec: z.number().int(),
  series: z.array(
    z.object({
      date: isoDate,
      inbound: z.number().int(),
      outbound: z.number().int(),
      missed: z.number().int(),
      answered: z.number().int(),
    }),
  ),
});

export const agentPerformanceDto = z.object({
  userId: uuid,
  name: z.string(),
  extension: z.string().nullable(),
  total: z.number().int(),
  inbound: z.number().int(),
  outbound: z.number().int(),
  answered: z.number().int(),
  missed: z.number().int(),
  totalTalkSec: z.number().int(),
  avgTalkSec: z.number(),
  avgRingSec: z.number(),
});

export const pipelineReportQuery = range.extend({
  pipelineId: uuid.optional(),
  ownerId: uuid.optional(),
});

export const pipelineSummaryDto = z.object({
  pipelineId: uuid,
  stages: z.array(
    z.object({
      stageId: uuid,
      name: z.string(),
      type: z.string(),
      openCount: z.number().int(),
      openValue: z.number(),
      weightedValue: z.number(),
    }),
  ),
  won: z.object({ count: z.number().int(), value: z.number() }),
  lost: z.object({ count: z.number().int(), value: z.number() }),
  winRate: z.number(),
  currency: z.string(),
});

export const pipelineConversionDto = z.object({
  pipelineId: uuid,
  created: z.number().int(),
  stages: z.array(
    z.object({ stageId: uuid, name: z.string(), reached: z.number().int(), pct: z.number() }),
  ),
  won: z.number().int(),
  lost: z.number().int(),
  winRate: z.number(),
  avgCycleDays: z.number().nullable(),
});

export const forecastQuery = z.object({
  pipelineId: uuid.optional(),
  months: z.coerce.number().int().min(1).max(12).default(3),
  ownerId: uuid.optional(),
  format: z.enum(['json', 'csv']).default('json'),
});
export const forecastDto = z.object({
  pipelineId: uuid,
  currency: z.string(),
  months: z.array(
    z.object({
      month: z.string(),
      count: z.number().int(),
      value: z.number(),
      weightedValue: z.number(),
    }),
  ),
  unscheduled: z.object({ count: z.number().int(), value: z.number() }),
});
