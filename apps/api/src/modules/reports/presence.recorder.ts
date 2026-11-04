/**
 * Writes the attendance record. Every call site is in the middle of something more important (a
 * sign-in, a socket closing, a PBX event), so nothing here is allowed to throw at them: losing one
 * row of attendance is better than failing a sign-in over it.
 */
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { newId } from '../../lib/ids.js';

export type CrmPresenceState = 'signed_in' | 'online' | 'offline' | 'signed_out';
export type PhonePresenceState = 'offline' | 'idle' | 'ringing' | 'on_call';

export class PresenceRecorder {
  constructor(
    private readonly db: FastifyInstance['db'],
    private readonly log: FastifyBaseLogger,
  ) {}

  crm(userId: string, state: CrmPresenceState, reason?: string): Promise<void> {
    return this.write(userId, 'crm', state, { reason });
  }

  /**
   * The PBX's view of an extension. A registration report carries only `registered`, a call-state
   * report only `callState`; registered and idle are the same state to a reader of this report.
   */
  phone(
    userId: string,
    extension: string,
    report: { registered: boolean } | { callState: 'idle' | 'ringing' | 'busy' },
  ): Promise<void> {
    let state: PhonePresenceState;
    if ('registered' in report) state = report.registered ? 'idle' : 'offline';
    else state = report.callState === 'busy' ? 'on_call' : report.callState;
    return this.write(userId, 'phone', state, { extension });
  }

  /**
   * After a crash nothing recorded the connections that died with the process, so each is closed at
   * the last moment it was known to be alive. Anyone really still there reconnects within seconds,
   * and the report folds a gap that short back into the same stretch.
   */
  async closeConnectionsLostInRestart(): Promise<void> {
    try {
      await this.db.$executeRaw`
        INSERT INTO agent_presence_events (id, user_id, channel, state, reason, inferred, at)
        SELECT gen_random_uuid(), latest.user_id, 'crm', 'offline', 'server_restart', TRUE,
               GREATEST(latest.at, COALESCE(u.last_seen_at, latest.at))
        FROM (
          SELECT DISTINCT ON (user_id) user_id, state, at
          FROM agent_presence_events
          WHERE channel = 'crm'
          ORDER BY user_id, at DESC
        ) latest
        JOIN users u ON u.id = latest.user_id
        WHERE latest.state = 'online'`;
    } catch (err) {
      this.log.warn({ err }, 'could not close connections left open by a restart');
    }
  }

  private async write(
    userId: string,
    channel: 'crm' | 'phone',
    state: string,
    extra: { reason?: string | undefined; extension?: string | undefined },
  ): Promise<void> {
    try {
      // The PBX and a second tab repeat themselves. A race past this check is harmless because the
      // report collapses repeats; the check only keeps the table small. A sign-in is never a repeat:
      // yesterday's may be the last thing recorded if no socket connected after it.
      const last = await this.db.agentPresenceEvent.findFirst({
        where: { userId, channel },
        orderBy: { at: 'desc' },
        select: { state: true },
      });
      if (state !== 'signed_in' && last?.state === state) return;
      await this.db.agentPresenceEvent.create({
        data: {
          id: newId(),
          userId,
          channel,
          state,
          reason: extra.reason ?? null,
          extension: extra.extension ?? null,
          at: new Date(),
        },
      });
    } catch (err) {
      this.log.warn({ err, userId, channel, state }, 'could not record a presence event');
    }
  }
}
