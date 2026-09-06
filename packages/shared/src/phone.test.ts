import { describe, expect, it } from 'vitest';
import { normalizePhone, toDialable, toE164 } from './phone.js';

describe('normalizePhone', () => {
  it('normalizes Kenyan national numbers to E.164', () => {
    const n = normalizePhone('0712 345 678', { defaultCountry: 'KE' });
    expect(n).toMatchObject({ kind: 'e164', e164: '+254712345678', country: 'KE' });
  });
  it('accepts international and 00-prefixed input', () => {
    expect(normalizePhone('+254712345678', { defaultCountry: 'KE' })).toMatchObject({
      e164: '+254712345678',
    });
    expect(normalizePhone('00254712345678', { defaultCountry: 'KE' })).toMatchObject({
      e164: '+254712345678',
    });
  });
  it('detects extensions by configured length', () => {
    expect(normalizePhone('1001', { defaultCountry: 'KE', internalExtensionLength: 4 })).toEqual({
      kind: 'extension',
      extension: '1001',
    });
  });
  it('flags withheld caller ids', () => {
    expect(normalizePhone('anonymous', { defaultCountry: 'KE' })).toEqual({ kind: 'withheld' });
    expect(normalizePhone('', { defaultCountry: 'KE' })).toEqual({ kind: 'withheld' });
  });
  it('flags invalid numbers without throwing', () => {
    expect(normalizePhone('12', { defaultCountry: 'KE' })).toEqual({ kind: 'invalid', raw: '12' });
  });
});

describe('toE164 / toDialable', () => {
  it('returns null for invalid input', () => {
    expect(toE164('abc', 'KE')).toBeNull();
  });
  it('dials national format for same-country numbers', () => {
    expect(
      toDialable(
        '+254712345678',
        { stripPlus: true, outboundPrefix: '', e164ToDialable: 'national' },
        'KE',
      ),
    ).toBe('0712345678');
  });
  it('dials international without plus for foreign numbers and applies prefix', () => {
    expect(
      toDialable(
        '+14155552671',
        { stripPlus: true, outboundPrefix: '9', e164ToDialable: 'national' },
        'KE',
      ),
    ).toBe('914155552671');
  });
});
