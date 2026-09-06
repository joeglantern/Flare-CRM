/**
 * Phone number helpers (docs/05 cross-cutting constraint 1, docs/06 §9).
 * Storage/matching is always E.164. Display uses national format.
 */
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
export type { CountryCode };

export type NormalizedNumber =
  | { kind: 'e164'; e164: string; country: CountryCode | undefined; national: string }
  | { kind: 'extension'; extension: string }
  | { kind: 'withheld' }
  | { kind: 'invalid'; raw: string };

const WITHHELD = new Set([
  '',
  'anonymous',
  'unknown',
  'restricted',
  'private',
  'unavailable',
  'withheld',
]);

export interface NormalizeOptions {
  defaultCountry: CountryCode;
  /** Numbers of exactly this many digits are treated as internal extensions. */
  internalExtensionLength?: number;
}

export function normalizePhone(
  rawInput: string | null | undefined,
  opts: NormalizeOptions,
): NormalizedNumber {
  const raw = (rawInput ?? '').trim();
  if (WITHHELD.has(raw.toLowerCase())) return { kind: 'withheld' };

  const digitsOnly = raw.replace(/[^\d+]/g, '');
  const extLen = opts.internalExtensionLength;
  if (extLen !== undefined && /^\d+$/.test(digitsOnly) && digitsOnly.length === extLen) {
    return { kind: 'extension', extension: digitsOnly };
  }

  let candidate = digitsOnly;
  if (candidate.startsWith('00')) candidate = `+${candidate.slice(2)}`;

  const parsed = parsePhoneNumberFromString(candidate, opts.defaultCountry);
  if (parsed?.isValid()) {
    return {
      kind: 'e164',
      e164: parsed.number,
      country: parsed.country,
      national: parsed.formatNational(),
    };
  }
  return { kind: 'invalid', raw };
}

/** Strict validator for user-entered numbers: returns E.164 or null. */
export function toE164(raw: string, defaultCountry: CountryCode): string | null {
  const n = normalizePhone(raw, { defaultCountry });
  return n.kind === 'e164' ? n.e164 : null;
}

export function formatNational(e164: string): string {
  const parsed = parsePhoneNumberFromString(e164);
  return parsed ? parsed.formatNational() : e164;
}

export function isE164(value: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(value);
}

export interface DialRules {
  stripPlus: boolean;
  outboundPrefix: string;
  e164ToDialable: 'national' | 'international';
}

/** Convert an E.164 number into what the PBX should dial (docs/06 §10). */
export function toDialable(e164: string, rules: DialRules, pbxCountry: CountryCode): string {
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed) return e164;
  let out: string;
  if (rules.e164ToDialable === 'national' && parsed.country === pbxCountry) {
    out = parsed.format('NATIONAL').replace(/[^\d]/g, '');
  } else {
    out = rules.stripPlus ? parsed.number.replace('+', '') : parsed.number;
  }
  return `${rules.outboundPrefix}${out}`;
}
