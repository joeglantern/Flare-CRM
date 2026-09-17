/**
 * The form derives a key and the API refuses one, so the two have to agree. They did not: any label
 * starting with a digit produced a key the API rejected, and all the dialog could say was that
 * validation had failed.
 */
import { describe, expect, it } from 'vitest';
import { CUSTOM_FIELD_KEY, createCustomFieldBody, customFieldKeyFrom } from './custom-field.js';

const LABELS = [
  'Region',
  'KRA PIN',
  '2FA status',
  '3rd party',
  'A',
  'Account #',
  'ID',
  '  spaced  out  ',
  'a'.repeat(60),
  'Ουρανός',
];

describe('a key derived from a label', () => {
  it('is one the API accepts, for every label that yields one at all', () => {
    for (const label of LABELS) {
      const key = customFieldKeyFrom(label);
      if (key === '') continue;
      expect(CUSTOM_FIELD_KEY.test(key), `${label} gave ${key}`).toBe(true);
      expect(
        createCustomFieldBody.safeParse({
          entity: 'contact',
          key,
          label: label.trim() === '' ? 'x' : label.trim().slice(0, 80),
          type: 'text',
        }).success,
        `${label} gave ${key}`,
      ).toBe(true);
    }
  });

  it('keeps a label that was already a key unchanged', () => {
    expect(customFieldKeyFrom('Region')).toBe('region');
    expect(customFieldKeyFrom('KRA PIN')).toBe('kra_pin');
  });

  it('moves a leading digit behind a letter rather than producing a refused key', () => {
    expect(customFieldKeyFrom('2FA status')).toBe('f_2fa_status');
    expect(customFieldKeyFrom('3rd party')).toBe('f_3rd_party');
  });

  it('gives a single letter a second character, since two is the minimum', () => {
    expect(customFieldKeyFrom('A')).toBe('a_');
  });

  it('says nothing rather than guessing, for a label with nothing to build on', () => {
    expect(customFieldKeyFrom('###')).toBe('');
    expect(customFieldKeyFrom('   ')).toBe('');
    expect(customFieldKeyFrom('Ουρανός')).toBe('');
  });

  it('does not end a truncated key on an underscore', () => {
    const key = customFieldKeyFrom(`${'a'.repeat(39)} tail`);
    expect(key).toHaveLength(39);
    expect(key.endsWith('_')).toBe(false);
  });
});

describe('creating a custom field', () => {
  it('insists on options for a choice field, which is the other way the dialog used to fail', () => {
    const base = { entity: 'contact', key: 'region', label: 'Region', type: 'select' } as const;
    expect(createCustomFieldBody.safeParse(base).success).toBe(false);
    expect(
      createCustomFieldBody.safeParse({ ...base, options: [{ value: 'nbo', label: 'Nairobi' }] })
        .success,
    ).toBe(true);
  });
});
