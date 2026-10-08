/**
 * Which agents sit in which PBX queue, kept in Valkey for the call state machine.
 *
 * A queue call carries its queue number in every extension leg's `call_path` (seen live: "6410"
 * on each agent ringing for the Test queue). With this directory the CRM pops the call to every
 * agent in that queue, not only to the ones whose ring it happened to hear about. Refreshed with
 * the extension sync, every ten minutes and at worker start.
 */
import type { Redis } from 'ioredis';
import type { YeastarClient } from './client.js';

const KEY = 'cti:queues';

export interface QueueEntry {
  number: string;
  name: string;
  extensions: string[];
}

export async function refreshQueues(client: YeastarClient, valkey: Redis): Promise<number> {
  const res = await client.queueList();
  const entries: Record<string, string> = {};
  for (const q of res.queue_list ?? []) {
    const extensions = [...(q.static_agent_list ?? []), ...(q.dynamic_agent_list ?? [])]
      .map((a) => a.text2?.trim() ?? '')
      .filter((n) => n !== '');
    entries[q.number] = JSON.stringify({
      number: q.number,
      // A queue with no name is shown by its number rather than as a blank.
      name: q.name?.trim() ? q.name.trim() : q.number,
      extensions: [...new Set(extensions)],
    } satisfies QueueEntry);
  }
  const multi = valkey.multi().del(KEY);
  if (Object.keys(entries).length > 0) multi.hset(KEY, entries);
  await multi.exec();
  return Object.keys(entries).length;
}

/** The queue a call came through, from its call path; null for a call that never was in one. */
export async function queueForCallPath(
  valkey: Redis,
  callPath: string | null,
): Promise<QueueEntry | null> {
  if (!callPath) return null;
  // The path is the queue number on its own today; read any number in it, in case it grows.
  for (const candidate of callPath.match(/\d+/g) ?? []) {
    const raw = await valkey.hget(KEY, candidate);
    if (!raw) continue;
    try {
      return JSON.parse(raw) as QueueEntry;
    } catch {
      return null;
    }
  }
  return null;
}
