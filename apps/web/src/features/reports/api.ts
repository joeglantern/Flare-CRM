/**
 * Reports (docs/09 · Reports). Types mirror packages/shared/src/schemas/report.ts exactly; the
 * screens compute nothing the server already returns.
 *
 * GAP-18: report scope comes from the caller's role, not from a parameter. `userId` and `teamId`
 * narrow within that scope, they do not widen it.
 * GAP-10: the forecast takes `months`, not a date range.
 * GAP-16: the call summary has no per-hour and no per-disposition breakdown, and agent rows carry
 * no disposition counts. Those charts cannot be drawn from this API.
 */
import { useQuery } from '@tanstack/react-query';
import { http, type OffsetList, type Query } from '@/lib/api/client';
import type { CallDto } from '@crm/shared';
import { qk } from '@/lib/query';

export interface RangeFilters extends Query {
  from?: string;
  to?: string;
  /** IANA zone for the daily buckets; the server defaults to the caller's profile timezone. */
  tz?: string;
  userId?: string;
  teamId?: string;
}

export interface CallsSummary {
  from: string;
  to: string;
  totals: {
    calls: number;
    inbound: number;
    outbound: number;
    internal: number;
    answered: number;
    missed: number;
    abandoned: number;
    busy: number;
    voicemail: number;
    failed: number;
  };
  /** Answered inbound over inbound, 0 to 1. Zero when there were no inbound calls. */
  answerRate: number;
  avgTalkSec: number;
  avgRingSec: number;
  totalTalkSec: number;
  series: { date: string; inbound: number; outbound: number; missed: number; answered: number }[];
  byHour: { hour: number; inbound: number; outbound: number; missed: number; answered: number }[];
  byDisposition: { dispositionId: string | null; name: string; count: number }[];
}

export interface AgentPerformanceRow {
  userId: string;
  name: string;
  extension: string | null;
  total: number;
  inbound: number;
  outbound: number;
  answered: number;
  missed: number;
  totalTalkSec: number;
  avgTalkSec: number;
  avgRingSec: number;
}

export interface PipelineSummary {
  pipelineId: string;
  stages: {
    stageId: string;
    name: string;
    type: string;
    openCount: number;
    openValue: number;
    weightedValue: number;
  }[];
  won: { count: number; value: number };
  lost: { count: number; value: number };
  winRate: number;
  currency: string;
}

export interface PipelineConversion {
  pipelineId: string;
  created: number;
  stages: { stageId: string; name: string; reached: number; pct: number }[];
  won: number;
  lost: number;
  winRate: number;
  avgCycleDays: number | null;
}

export interface Forecast {
  pipelineId: string;
  currency: string;
  months: { month: string; count: number; value: number; weightedValue: number }[];
  unscheduled: { count: number; value: number };
}

export function useCallsSummary(filters: RangeFilters, enabled = true) {
  return useQuery({
    queryKey: qk.list('report-calls-summary', filters),
    enabled,
    queryFn: () => http.get<CallsSummary>('/api/v1/reports/calls/summary', filters),
  });
}

export function useAgentPerformance(filters: RangeFilters, enabled = true) {
  return useQuery({
    queryKey: qk.list('report-agents', filters),
    enabled,
    queryFn: () => http.get<AgentPerformanceRow[]>('/api/v1/reports/calls/agents', filters),
  });
}

/** The missed queue is a filtered call list, so the rows are plain calls. */
export function useMissedCallsReport(filters: Query = {}, enabled = true) {
  return useQuery({
    queryKey: qk.list('report-missed', filters),
    enabled,
    queryFn: (): Promise<OffsetList<CallDto>> =>
      http.list<CallDto>('/api/v1/reports/calls/missed', filters),
  });
}

export function usePipelineSummary(
  filters: RangeFilters & { pipelineId?: string; ownerId?: string },
  enabled = true,
) {
  return useQuery({
    queryKey: qk.list('report-pipeline-summary', filters),
    enabled,
    queryFn: () => http.get<PipelineSummary>('/api/v1/reports/pipeline/summary', filters),
  });
}

export function usePipelineConversion(
  filters: RangeFilters & { pipelineId?: string; ownerId?: string },
  enabled = true,
) {
  return useQuery({
    queryKey: qk.list('report-pipeline-conversion', filters),
    enabled,
    queryFn: () => http.get<PipelineConversion>('/api/v1/reports/pipeline/conversion', filters),
  });
}

export function useForecast(
  filters: { pipelineId?: string; months?: number; ownerId?: string },
  enabled = true,
) {
  return useQuery({
    queryKey: qk.list('report-forecast', filters),
    enabled,
    queryFn: () =>
      http.get<Forecast>('/api/v1/reports/pipeline/forecast', { months: 3, ...filters }),
  });
}
