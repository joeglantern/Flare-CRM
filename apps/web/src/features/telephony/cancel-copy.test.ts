import { describe, expect, it } from 'vitest';
import { cancelledCopy } from './cancel-copy';
import { useCallStore } from './call-store';

describe('what an agent is told when a call ends before connecting', () => {
  it('never calls a refused or unrung dial "Nobody answered"', () => {
    expect(cancelledCopy({ reason: 'refused', outbound: true }).title).toBe('Call not placed');
    expect(cancelledCopy({ reason: 'no_ring', outbound: true }).title).toBe(
      'Your phone never rang',
    );
    expect(cancelledCopy({ reason: 'timeout', outbound: true }).title).toBe('Call not connected');
    expect(cancelledCopy({ reason: 'caller_hung_up', outbound: true }).title).toBe(
      'Call ended before it connected',
    );
  });

  it('keeps the inbound wording for inbound calls', () => {
    expect(cancelledCopy({ reason: 'timeout', outbound: false }).title).toBe('Nobody answered');
    expect(cancelledCopy({ reason: 'caller_hung_up', outbound: false }).title).toBe(
      'Caller hung up',
    );
  });

  it("carries the server's reason and removes the dialing card", () => {
    const store = useCallStore.getState();
    store.reset();
    store.onDialing({
      at: new Date().toISOString(),
      callId: '01a00000-0000-7000-8000-00000000d1a1',
      pbxCallId: 'dial.9',
      callee: '0712000001',
    });
    store.onCancelled({
      at: new Date().toISOString(),
      callId: '01a00000-0000-7000-8000-00000000d1a1',
      pbxCallId: 'dial.9',
      reason: 'refused',
      detail: 'extension 1002 is not allowed to dial this number',
    });
    const after = useCallStore.getState();
    expect(after.cards).toHaveLength(0);
    expect(after.lastCancelled).toMatchObject({
      reason: 'refused',
      outbound: true,
      detail: 'extension 1002 is not allowed to dial this number',
    });
  });
});
