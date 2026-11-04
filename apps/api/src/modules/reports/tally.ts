/**
 * Checks the CRM's calls against the phone system's own records, so a report can be trusted rather
 * than argued about.
 *
 * The PBX's list is longer than the number of calls it had: an answered queue call is listed twice
 * under one uid, once as the queue and once as the agent. So rows are collapsed by uid first, and
 * the screen says how many rows became how many calls, because that difference is what a person
 * comparing the two screens sees first.
 */
import type { FastifyInstance } from 'fastify';
import { cdrSearchRow } from '../../integrations/yeastar/events.js';
import { PbxUnavailableError } from '../../lib/errors.js';

const PAGE_SIZE = 100;
/** Twenty thousand rows. Past that the check says it is partial rather than taking minutes. */
const MAX_PAGES = 200;
/** How far apart two talk times may be and still count as the same: the PBX rounds per leg. */
const TALK_TOLERANCE_SEC = 2;

export type TallyDirection = 'inbound' | 'outbound' | 'internal';
export type TallyOutcome = 'answered' | 'not_answered';

export interface TallyLine {
  direction: TallyDirection;
  outcome: TallyOutcome;
  phoneSystem: number;
  crm: number;
}

export interface TallyResult {
  from: string;
  to: string;
  checkedAt: string;
  /** Rows on the PBX's own list, which is the number a person reading that list sees. */
  phoneSystemRows: number;
  phoneSystemCalls: number;
  crmCalls: number;
  phoneSystemTalkSec: number;
  crmTalkSec: number;
  lines: TallyLine[];
  /** Calls on the PBX the CRM does not hold. Bringing them in is one click. */
  missingFromCrm: number;
  /** Calls the CRM holds in the range that the PBX did not list. */
  onlyInCrm: number;
  /** Same call, different type, outcome or talk time. */
  differing: number;
  /** False when the range was too large to read to the end. */
  complete: boolean;
  agrees: boolean;
}

interface PbxCall {
  direction: TallyDirection;
  answered: boolean;
  talkSec: number;
}

function directionOf(callType: string): TallyDirection {
  const t = callType.toLowerCase();
  return t === 'inbound' ? 'inbound' : t === 'outbound' ? 'outbound' : 'internal';
}

/** Collapses the PBX's rows to one call per uid, and is pure so a test can read it directly. */
export function collapseRows(
  rows: { uid: string; call_type: string; disposition: string; talk_duration: number }[],
): Map<string, PbxCall> {
  const calls = new Map<string, PbxCall>();
  for (const row of rows) {
    const answered = row.disposition.toUpperCase() === 'ANSWERED';
    const seen = calls.get(row.uid);
    calls.set(row.uid, {
      direction: seen?.direction ?? directionOf(row.call_type),
      answered: answered || (seen?.answered ?? false),
      talkSec: Math.max(row.talk_duration, seen?.talkSec ?? 0),
    });
  }
  return calls;
}

export async function tallyCalls(
  app: FastifyInstance,
  range: { from: Date; to: Date },
): Promise<TallyResult> {
  const client = app.cti.client;
  if (!app.cti.enabled || !client) {
    throw new PbxUnavailableError('Telephony integration is not enabled');
  }

  const parsedRows: {
    uid: string;
    call_type: string;
    disposition: string;
    talk_duration: number;
  }[] = [];
  let complete = false;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await client.cdrSearch({
      start_time: Math.floor(range.from.getTime() / 1000),
      end_time: Math.floor(range.to.getTime() / 1000),
      page,
      page_size: PAGE_SIZE,
    });
    const rows = res.data ?? [];
    for (const row of rows) {
      const parsed = cdrSearchRow.safeParse(row);
      if (parsed.success) parsedRows.push(parsed.data);
    }
    if (rows.length < PAGE_SIZE) {
      complete = true;
      break;
    }
  }
  const pbx = collapseRows(parsedRows);

  // Widened on both sides for the check of which calls exist: a call's merged start can sit a
  // little before the row the PBX filed it under, and that is not a disagreement.
  const margin = 15 * 60 * 1000;
  const held = await app.db.call.findMany({
    where: {
      pbxCdrUid: { not: null },
      startedAt: {
        gte: new Date(range.from.getTime() - margin),
        lt: new Date(range.to.getTime() + margin),
      },
    },
    select: {
      pbxCdrUid: true,
      direction: true,
      status: true,
      talkDurationSec: true,
      startedAt: true,
    },
  });
  const heldByUid = new Map(held.map((c) => [c.pbxCdrUid ?? '', c]));
  const inRange = held.filter((c) => c.startedAt >= range.from && c.startedAt < range.to);

  let missingFromCrm = 0;
  let differing = 0;
  for (const [uid, call] of pbx) {
    const mine = heldByUid.get(uid);
    if (!mine) {
      missingFromCrm++;
      continue;
    }
    const sameTalk = Math.abs((mine.talkDurationSec ?? 0) - call.talkSec) <= TALK_TOLERANCE_SEC;
    const sameOutcome = (mine.status === 'completed') === call.answered;
    if (mine.direction !== call.direction || !sameOutcome || !sameTalk) differing++;
  }
  const onlyInCrm = inRange.filter((c) => !pbx.has(c.pbxCdrUid ?? '')).length;

  const directions: TallyDirection[] = ['inbound', 'outbound', 'internal'];
  const lines: TallyLine[] = directions.flatMap((direction) =>
    (['answered', 'not_answered'] as const).map((outcome) => {
      const wantAnswered = outcome === 'answered';
      return {
        direction,
        outcome,
        phoneSystem: [...pbx.values()].filter(
          (c) => c.direction === direction && c.answered === wantAnswered,
        ).length,
        crm: inRange.filter(
          (c) => c.direction === direction && (c.status === 'completed') === wantAnswered,
        ).length,
      };
    }),
  );

  const phoneSystemTalkSec = [...pbx.values()].reduce((sum, c) => sum + c.talkSec, 0);
  const crmTalkSec = inRange.reduce((sum, c) => sum + (c.talkDurationSec ?? 0), 0);
  return {
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    checkedAt: new Date().toISOString(),
    phoneSystemRows: parsedRows.length,
    phoneSystemCalls: pbx.size,
    crmCalls: inRange.length,
    phoneSystemTalkSec,
    crmTalkSec,
    lines,
    missingFromCrm,
    onlyInCrm,
    differing,
    complete,
    agrees: complete && missingFromCrm === 0 && differing === 0,
  };
}
