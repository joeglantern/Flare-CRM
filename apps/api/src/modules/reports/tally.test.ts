import { describe, expect, it } from 'vitest';
import { collapseRows } from './tally.js';

describe('collapseRows', () => {
  it('counts an answered queue call once, however many rows the PBX lists it under', () => {
    const calls = collapseRows([
      { uid: 'a', call_type: 'Inbound', disposition: 'ANSWERED', talk_duration: 100 },
      { uid: 'a', call_type: 'Inbound', disposition: 'ANSWERED', talk_duration: 99 },
      { uid: 'b', call_type: 'Outbound', disposition: 'NO ANSWER', talk_duration: 0 },
      { uid: 'b', call_type: 'Outbound', disposition: 'FAILED', talk_duration: 0 },
    ]);
    expect(calls.size).toBe(2);
    expect(calls.get('a')).toEqual({ direction: 'inbound', answered: true, talkSec: 100 });
    expect(calls.get('b')).toEqual({ direction: 'outbound', answered: false, talkSec: 0 });
  });
});
