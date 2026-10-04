import type { ContactSummaryDto } from '@crm/shared';
import { describe, expect, it } from 'vitest';
import { cleanNumber, lookupOutcome } from './caller-lookup';

const contact = (id: string, displayName: string): ContactSummaryDto => ({
  id,
  displayName,
  company: null,
  primaryPhone: '+254712000001',
  primaryEmail: null,
  ownerId: null,
  avatarUrl: null,
  tags: [],
  doNotCall: false,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
});

describe('where the phone system popup lands', () => {
  it('opens the contact when exactly one has the number', () => {
    expect(lookupOutcome('0712000001', [contact('a', 'Jane')])).toEqual({
      kind: 'contact',
      contactId: 'a',
    });
  });

  it('shows the caller page, with the number kept, when nobody has it', () => {
    expect(lookupOutcome('0712000001', [])).toEqual({
      kind: 'unknown',
      number: '0712000001',
      candidates: [],
    });
  });

  it('lets the agent choose when more than one contact has it', () => {
    const rows = [contact('a', 'Jane'), contact('b', 'Janet')];
    expect(lookupOutcome('0712000001', rows)).toEqual({
      kind: 'unknown',
      number: '0712000001',
      candidates: rows,
    });
  });

  it('has nowhere to go without a number', () => {
    expect(lookupOutcome('', [contact('a', 'Jane')])).toEqual({ kind: 'none' });
  });
});

describe('reading the number from the address', () => {
  it('takes it however the router parsed it', () => {
    expect(cleanNumber(' 0712000001 ')).toBe('0712000001');
    // No leading zero, so the router's JSON reading hands over a number.
    expect(cleanNumber(254712000001)).toBe('254712000001');
  });

  it('treats anything else as no number', () => {
    expect(cleanNumber(undefined)).toBe('');
    expect(cleanNumber(null)).toBe('');
    expect(cleanNumber(true)).toBe('');
  });
});
