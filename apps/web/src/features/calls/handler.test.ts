import { describe, expect, it } from 'vitest';
import { callHandler } from './handler';

describe('who handled a call', () => {
  const call = {
    user: null,
    extension: '1002',
    direction: 'inbound',
    status: 'completed',
  } as const;

  it('names the CRM user when there is one', () => {
    expect(callHandler({ ...call, user: { id: 'u', name: 'Amina' } })).toBe('Amina');
  });

  it('falls back to the extension for a phone with no CRM user', () => {
    expect(callHandler(call)).toBe('Extension 1002');
  });

  it('does not credit an extension that only rang', () => {
    expect(callHandler({ ...call, status: 'missed' })).toBeNull();
  });

  it('credits the extension that placed an outbound call, whatever the outcome', () => {
    expect(callHandler({ ...call, direction: 'outbound', status: 'busy' })).toBe('Extension 1002');
  });

  it('names nobody when there is no extension', () => {
    expect(callHandler({ ...call, extension: null })).toBeNull();
  });
});
