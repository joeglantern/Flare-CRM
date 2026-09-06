import { beforeEach, describe, expect, it } from 'vitest';
import { activeCall, talkSeconds, useCallStore, type RingingPayload } from './call-store';

const ME = '01a00000-0000-7000-8000-000000000001';
const OTHER = '01a00000-0000-7000-8000-000000000002';
const CALL_ID = '01a00000-0000-7000-8000-00000000c001';

function ringing(pbxCallId: string, at = '2026-09-05T12:00:00.000Z'): RingingPayload {
  return {
    at,
    callId: CALL_ID,
    pbxCallId,
    direction: 'inbound',
    callerNumber: '+254712345678',
    callerDisplay: '0712 345678',
    trunkName: 'Safaricom',
    didNumber: '0207654321',
    callPath: null,
    contact: null,
    matchCandidates: [],
    recentActivity: [],
    restricted: false,
    capabilities: {
      answer: 'none',
      decline: true,
      hangup: true,
      hold: true,
      mute: false,
      transfer: true,
    },
  };
}

describe('call store state machine', () => {
  beforeEach(() => {
    useCallStore.getState().reset();
  });

  it('pops a ringing card once, newest first, and measures pop latency from the server timestamp', () => {
    const s = useCallStore.getState();
    s.onRinging(ringing('a'), Date.parse('2026-09-05T12:00:00.180Z'));
    s.onRinging(ringing('a'), Date.parse('2026-09-05T12:00:00.500Z')); // duplicate delivery
    s.onRinging(ringing('b'), Date.parse('2026-09-05T12:00:01.000Z'));
    const cards = useCallStore.getState().cards;
    expect(cards.map((c) => c.pbxCallId)).toEqual(['b', 'a']);
    expect(cards[1]?.popLatencyMs).toBe(180);
    expect(cards[1]?.status).toBe('ringing');
  });

  it('walks ringing -> answered -> ended -> logged with server timestamps', () => {
    const s = useCallStore.getState();
    s.onRinging(ringing('a'));
    s.onAnswered(
      {
        at: '2026-09-05T12:00:05Z',
        callId: CALL_ID,
        pbxCallId: 'a',
        answeredByUserId: ME,
        answeredByExtension: '1001',
        answeredAt: '2026-09-05T12:00:05.000Z',
      },
      ME,
    );
    let card = useCallStore.getState().cards[0]!;
    expect(card.status).toBe('answered');
    expect(card.answeredByMe).toBe(true);
    expect(talkSeconds(card, Date.parse('2026-09-05T12:01:05Z'))).toBe(60);
    expect(activeCall(useCallStore.getState().cards)?.pbxCallId).toBe('a');

    s.onUpdated({ at: '2026-09-05T12:00:30Z', callId: CALL_ID, pbxCallId: 'a', hold: true });
    expect(useCallStore.getState().cards[0]?.hold).toBe(true);

    s.onEnded({
      at: '2026-09-05T12:02:05Z',
      callId: CALL_ID,
      pbxCallId: 'a',
      endedAt: '2026-09-05T12:02:05.000Z',
    });
    card = useCallStore.getState().cards[0]!;
    expect(card.status).toBe('ended');
    expect(card.hold).toBe(false);
    expect(talkSeconds(card, Date.parse('2026-09-05T12:30:00Z'))).toBe(120); // frozen at endedAt

    s.onLogged({
      at: '2026-09-05T12:02:06Z',
      callId: CALL_ID,
      pbxCallId: 'a',
      status: 'answered',
      talkDurationSec: 120,
      totalDurationSec: 125,
      contactId: null,
      suggestFollowUp: true,
      recordingStatus: 'pending',
    });
    card = useCallStore.getState().cards[0]!;
    expect(card.status).toBe('logged');
    expect(card.logged?.suggestFollowUp).toBe(true);
    expect(activeCall(useCallStore.getState().cards)).toBeUndefined();

    s.close('a');
    expect(useCallStore.getState().cards).toHaveLength(0);
  });

  it('removes the card when the call is cancelled and remembers why', () => {
    const s = useCallStore.getState();
    s.onRinging(ringing('a'));
    s.onCancelled({
      at: '2026-09-05T12:00:09Z',
      callId: CALL_ID,
      pbxCallId: 'a',
      reason: 'answered_elsewhere',
    });
    const state = useCallStore.getState();
    expect(state.cards).toHaveLength(0);
    expect(state.lastCancelled).toEqual({
      pbxCallId: 'a',
      reason: 'answered_elsewhere',
      callerDisplay: '0712 345678',
    });
    state.clearCancelled();
    expect(useCallStore.getState().lastCancelled).toBeNull();
  });

  it('marks calls answered by a colleague as not mine and ignores logs for unseen calls', () => {
    const s = useCallStore.getState();
    s.onRinging(ringing('a'));
    s.onAnswered(
      {
        at: '2026-09-05T12:00:05Z',
        callId: CALL_ID,
        pbxCallId: 'a',
        answeredByUserId: OTHER,
        answeredByExtension: '1002',
        answeredAt: '2026-09-05T12:00:05.000Z',
      },
      ME,
    );
    expect(useCallStore.getState().cards[0]?.answeredByMe).toBe(false);
    s.onLogged({
      at: '2026-09-05T12:02:06Z',
      callId: CALL_ID,
      pbxCallId: 'zzz',
      status: 'missed',
      talkDurationSec: null,
      totalDurationSec: 20,
      contactId: null,
      suggestFollowUp: false,
      recordingStatus: 'none',
    });
    expect(useCallStore.getState().cards).toHaveLength(1);
  });

  it('tracks outbound dialing cards', () => {
    const s = useCallStore.getState();
    s.onDialing({
      at: '2026-09-05T12:00:00Z',
      callId: CALL_ID,
      pbxCallId: 'out1',
      callee: '+254733000009',
    });
    const card = useCallStore.getState().cards[0]!;
    expect(card.status).toBe('dialing');
    expect(card.direction).toBe('outbound');
    expect(card.callee).toBe('+254733000009');
    expect(activeCall(useCallStore.getState().cards)?.pbxCallId).toBe('out1');
  });
});
