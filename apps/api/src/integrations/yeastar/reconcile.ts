/**
 * CDR gap-fill (docs/06 §13): pull CDRs from the PBX since the last one we saw and apply them
 * through the same idempotent path as live events.
 */
import type { Redis } from 'ioredis';
import type { CallStateMachine } from './call-state.js';
import type { YeastarClient } from './client.js';
import { cdrMsg } from './events.js';

export interface ReconcileResult {
  since: string;
  scanned: number;
  inserted: number;
  updated: number;
}

const LAST_CDR_KEY = 'cti:last_cdr_at';
const LAST_RECONCILE_KEY = 'cti:last_reconcile_at';

export async function reconcileCdrs(
  deps: {
    client: YeastarClient;
    machine: CallStateMachine;
    valkey: Redis;
    pbxTimeZone: string;
    log: { info: (o: unknown, m: string) => void };
  },
  sinceOverride?: Date,
): Promise<ReconcileResult> {
  const lastSeen = await deps.valkey.get(LAST_CDR_KEY);
  const since =
    sinceOverride ??
    new Date((lastSeen ? Date.parse(lastSeen) : Date.now() - 24 * 60 * 60 * 1000) - 5 * 60 * 1000);
  const until = new Date(Date.now() + 60 * 1000);
  let page = 1;
  let scanned = 0;
  let inserted = 0;
  let updated = 0;
  for (;;) {
    const res = await deps.client.cdrSearch({
      start_time: formatPbxTime(since, deps.pbxTimeZone),
      end_time: formatPbxTime(until, deps.pbxTimeZone),
      page,
      page_size: 100,
      sort_by: 'time_start',
      order_by: 'asc',
    });
    const rows = res.data ?? [];
    for (const row of rows) {
      const parsed = cdrMsg.safeParse(row);
      if (!parsed.success) continue;
      scanned++;
      const outcome = await deps.machine.applyCdr(parsed.data, 'reconcile');
      if (outcome === 'inserted') inserted++;
      else updated++;
    }
    if (rows.length < 100) break;
    page++;
    if (page > 200) break; // safety cap: 20k CDRs per run
  }
  await deps.valkey.set(LAST_RECONCILE_KEY, new Date().toISOString());
  deps.log.info(
    { since: since.toISOString(), scanned, inserted, updated },
    'CDR reconciliation complete',
  );
  return { since: since.toISOString(), scanned, inserted, updated };
}

/** PBX expects local wall-clock "YYYY-MM-DD HH:mm:ss". */
export function formatPbxTime(d: Date, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

export async function lastReconcileAt(valkey: Redis): Promise<string | null> {
  return valkey.get(LAST_RECONCILE_KEY);
}
