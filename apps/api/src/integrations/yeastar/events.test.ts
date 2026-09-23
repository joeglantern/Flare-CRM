/**
 * The PBX describes the same call twice, in two different shapes: the 30012 event and a row from
 * `GET /cdr/search`. They share a vocabulary for the values and almost nothing for the field names,
 * and the reconciler reading one with the other's parser is why it imported nothing for as long as
 * it existed while reporting success every ten minutes.
 */
import { describe, expect, it } from 'vitest';
import {
  cdrFromSearchRow,
  cdrMsg,
  cdrSearchRow,
  formatPbxTime,
  knownEvent,
  parsePbxTime,
  unwrapFrame,
  unwrapParty,
} from './events.js';

const NAIROBI = 'Africa/Nairobi';

/** Copied from a live PBX, trimmed only of what the parser ignores. */
const searchRow = {
  time: '04/27/2026 18:41:34',
  call_from: '0745150974<0745150974>',
  call_to: 'Queue Emergency<6400>',
  timestamp: 1777304494,
  uid: '20260427184134D5F8F',
  src_trunk: 'Saf',
  duration: 62,
  ring_duration: 18,
  talk_duration: 44,
  disposition: 'ANSWERED',
  call_type: 'Inbound',
  call_id: '1777304494.97',
  did: '',
  did_name: '',
  pin_code: '',
  call_note_id: '',
  enb_call_note: 1,
};

describe('a CDR row from the search endpoint', () => {
  it('reads, where the event parser cannot', () => {
    expect(cdrSearchRow.safeParse(searchRow).success).toBe(true);
    // The proof of the original fault: every required field the REST shape renames is missing here.
    expect(cdrMsg.safeParse(searchRow).success).toBe(false);
  });

  it('becomes the shape the rest of the pipeline already understands', () => {
    const cdr = cdrFromSearchRow(cdrSearchRow.parse(searchRow), NAIROBI);
    expect(cdrMsg.safeParse(cdr).success).toBe(true);
    expect(cdr).toMatchObject({
      uid: '20260427184134D5F8F',
      call_id: '1777304494.97',
      call_duration: 62,
      talk_duration: 44,
      agent_ring_time: 18,
      status: 'ANSWERED',
      type: 'Inbound',
      src_trunk_name: 'Saf',
    });
  });

  /**
   * The row carries both a unix timestamp and a `time` string, and only the first is unambiguous:
   * `time` is MM/DD/YYYY, which the event parser does not recognise and would hand to the runtime's
   * own date parsing, landing on the server's zone rather than the PBX's.
   */
  it('keeps the instant exactly, through the wall clock and back', () => {
    const cdr = cdrFromSearchRow(cdrSearchRow.parse(searchRow), NAIROBI);
    expect(parsePbxTime(cdr.time_start, NAIROBI).getTime()).toBe(searchRow.timestamp * 1000);
  });

  it('formats and parses as inverses of each other', () => {
    const at = new Date('2026-09-16T23:06:36.000Z');
    expect(parsePbxTime(formatPbxTime(at, NAIROBI), NAIROBI).getTime()).toBe(at.getTime());
  });

  it('survives a row with only what the PBX always sends', () => {
    const sparse = {
      uid: 'u1',
      call_id: 'c1',
      timestamp: 1777304494,
      disposition: 'NO ANSWER',
      call_type: 'Outbound',
    };
    const cdr = cdrFromSearchRow(cdrSearchRow.parse(sparse), NAIROBI);
    expect(cdrMsg.safeParse(cdr).success).toBe(true);
    expect(cdr.call_duration).toBe(0);
    expect(cdr.recording).toBe('');
  });
});

/**
 * Copied from the live PBX's own archive: `msg` arrives as a JSON string inside the frame. Every
 * call event the PBX ever sent looked like this, and every one was archived and dropped because
 * the schemas describe the decoded object. No popup and no user on any call came from this.
 */
const liveFrame = {
  sn: '3651064E8358',
  type: 30012,
  msg: '{"call_id":"1790197458.5215","time_start":"2026-09-24 00:04:18","call_from":"0111050596","call_to":"1002","call_duration":11,"talk_duration":11,"src_trunk_name":"Saf","dst_trunk_name":"","pin_code":"","status":"VOICEMAIL","type":"Inbound","recording":"","did_number":"","did_name":"","agent_ring_time":0,"uid":"2026092400041852EE8","call_note_id":"20260924000418-0FA8E","enb_call_note":4,"is_display":1,"realclidnum":""}',
};

describe('a frame as the PBX sends it', () => {
  it('is not readable as sent, which is the fault', () => {
    expect(knownEvent.safeParse(liveFrame).success).toBe(false);
  });

  it('is readable once the string body is decoded', () => {
    const parsed = knownEvent.safeParse(unwrapFrame(liveFrame));
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.type === 30012) {
      expect(parsed.data.msg.call_id).toBe('1790197458.5215');
      expect(parsed.data.msg.call_to).toBe('1002');
      expect(parsed.data.msg.status).toBe('VOICEMAIL');
    }
  });

  it('decodes a ringing event the same way', () => {
    const ringing = {
      type: 30011,
      sn: 'X',
      msg: JSON.stringify({
        call_id: '1790197458.5215',
        members: [
          {
            inbound: {
              from: '0111050596',
              to: '1002',
              channel_id: 'PJSIP/t-1',
              member_status: 'ANSWERED',
            },
          },
          { extension: { number: '1002', channel_id: 'PJSIP/1002-1', member_status: 'RING' } },
        ],
      }),
    };
    const parsed = knownEvent.safeParse(unwrapFrame(ringing));
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.type === 30011) {
      expect(parsed.data.msg.members[1]?.extension?.number).toBe('1002');
    }
  });

  it('leaves a frame whose body is already an object alone', () => {
    const decoded = unwrapFrame(liveFrame);
    expect(unwrapFrame(decoded)).toEqual(decoded);
  });

  it('leaves a body that is not JSON untouched, so it still reaches the archive', () => {
    const bad = { type: 30012, msg: '{not json' };
    expect(unwrapFrame(bad)).toEqual(bad);
    expect(unwrapFrame('heartbeat response')).toBe('heartbeat response');
    expect(unwrapFrame(null)).toBeNull();
  });
});

describe('a party as the search endpoint prints it', () => {
  it('keeps only the number, which is what the lookup needs', () => {
    expect(unwrapParty('Queue Emergency<6400>')).toBe('6400');
    expect(unwrapParty('0745150974<0745150974>')).toBe('0745150974');
    expect(unwrapParty('Liban Liban<1002>')).toBe('1002');
  });

  it('passes a bare number through, and an empty name too', () => {
    expect(unwrapParty('1002')).toBe('1002');
    expect(unwrapParty('<1002>')).toBe('1002');
    expect(unwrapParty('')).toBe('');
  });

  it('is applied to a search row, so a backfilled call reads like an evented one', () => {
    const cdr = cdrFromSearchRow(cdrSearchRow.parse(searchRow), NAIROBI);
    expect(cdr.call_from).toBe('0745150974');
    expect(cdr.call_to).toBe('6400');
  });
});
