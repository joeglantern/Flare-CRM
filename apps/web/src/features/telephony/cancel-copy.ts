/**
 * How an ended-before-connecting call is put to the agent. Kept apart from the popup so the words
 * are tested on their own: a dial that was refused or never rang must never read as
 * "Nobody answered", which is what hid a click-to-call that was never placed.
 */
import type { CancelledEvent } from './call-store';

/** Seconds a dialing card may wait for any word from the phone system before it says so. */
export const DIAL_SILENCE_SEC = 45;

export function cancelledCopy(c: { reason: CancelledEvent['reason']; outbound: boolean }): {
  title: string;
  tone: 'danger' | 'warning' | 'neutral';
} {
  switch (c.reason) {
    case 'refused':
      return { title: 'Call not placed', tone: 'danger' };
    case 'no_ring':
      return { title: 'Your phone never rang', tone: 'danger' };
    case 'abandoned':
      return { title: 'Call cancelled', tone: 'neutral' };
    case 'answered_elsewhere':
      return { title: 'Answered by a colleague', tone: 'neutral' };
    case 'timeout':
      return { title: c.outbound ? 'Call not connected' : 'Nobody answered', tone: 'warning' };
    case 'caller_hung_up':
      return {
        title: c.outbound ? 'Call ended before it connected' : 'Caller hung up',
        tone: 'neutral',
      };
  }
}
