/**
 * The PBX describes the same call twice, in two different shapes: the 30012 event and a row from
 * `GET /cdr/search`. They share a vocabulary for the values and almost nothing for the field names,
 * and the reconciler reading one with the other's parser is why it imported nothing for as long as
 * it existed while reporting success every ten minutes.
 */
import { describe, expect, it } from 'vitest';
import { cdrFromSearchRow, cdrMsg, cdrSearchRow, formatPbxTime, parsePbxTime } from './events.js';

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
