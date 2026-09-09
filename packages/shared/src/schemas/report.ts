import { z } from 'zod';
import { callDto } from './call.js';
import { isoDate, isoDateTime, paginationOffset, uuid } from './common.js';

const range = z.object({
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  /** IANA zone used for daily buckets; defaults to the caller's profile timezone. */
  tz: z.string().max(64).optional(),
  format: z.enum(['json', 'csv']).default('json'),
});

export const callsReportQuery = range.extend({ userId: uuid.optional(), teamId: uuid.optional() });
/**
 * A missed call with what an agent needs to act on it: how many times this number has been missed
 * in the window, and whether anyone has already called it back. Computed on the server across the
 * whole window, not from whatever page of outbound calls happened to be loaded.
 */
export const missedCallDto = callDto.extend({
  attempts: z.number().int(),
  returned: z.boolean(),
  returnedAt: isoDateTime.nullable(),
});
export type MissedCallDto = z.infer<typeof missedCallDto>;

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
  /** All twenty-four hours in the report time zone, zero where nothing happened. */
  byHour: z.array(
    z.object({
      hour: z.number().int().min(0).max(23),
      inbound: z.number().int(),
      outbound: z.number().int(),
      missed: z.number().int(),
      answered: z.number().int(),
    }),
  ),
  /** Calls per outcome; `dispositionId` is null for calls that were never dispositioned. */
  byDisposition: z.array(
    z.object({ dispositionId: uuid.nullable(), name: z.string(), count: z.number().int() }),
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
