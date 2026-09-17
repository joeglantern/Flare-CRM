/**
 * CDR gap-fill (docs/06 §13): pull CDRs from the PBX since the last one we saw and apply them
 * through the same idempotent path as live events.
 */
import type { Redis } from 'ioredis';
import type { CallStateMachine } from './call-state.js';
import type { YeastarClient } from './client.js';
import { cdrFromSearchRow, cdrSearchRow } from './events.js';

export { formatPbxTime } from './events.js';

export interface ReconcileResult {
  since: string;
  scanned: number;
  inserted: number;
  updated: number;
  /** Rows the PBX returned that this build could not read. Never silently zero. */
  unreadable: number;
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
  let unreadable = 0;
  for (;;) {
    // Unix seconds, not the wall clock the events speak in: this endpoint validates these two and
    // refuses a formatted string outright, which is what stopped every run before this.
    const res = await deps.client.cdrSearch({
      start_time: Math.floor(since.getTime() / 1000),
      end_time: Math.floor(until.getTime() / 1000),
      page,
      page_size: 100,
    });
    const rows = res.data ?? [];
    for (const row of rows) {
      const parsed = cdrSearchRow.safeParse(row);
      if (!parsed.success) {
        // Counted and reported rather than skipped in silence. A shape this code cannot read is
        // the difference between "nothing happened" and "nothing was imported", and the two used
        // to look identical from the outside.
        unreadable++;
        continue;
      }
      scanned++;
      const outcome = await deps.machine.applyCdr(
        cdrFromSearchRow(parsed.data, deps.pbxTimeZone),
        'reconcile',
      );
      if (outcome === 'inserted') inserted++;
      else updated++;
    }
    if (rows.length < 100) break;
    page++;
    if (page > 200) break; // safety cap: 20k CDRs per run
  }
  await deps.valkey.set(LAST_RECONCILE_KEY, new Date().toISOString());
  deps.log.info(
    { since: since.toISOString(), scanned, inserted, updated, unreadable },
    'CDR reconciliation complete',
  );
  return { since: since.toISOString(), scanned, inserted, updated, unreadable };
}

export async function lastReconcileAt(valkey: Redis): Promise<string | null> {
  return valkey.get(LAST_RECONCILE_KEY);
}
