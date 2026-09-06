/**
 * Phone display (docs/17 section 4, docs/18): national format first, E.164 as the monospace
 * secondary or tooltip. All parsing lives in @crm/shared so the web never disagrees with the API.
 */
import { formatNational, isE164, normalizePhone, toE164, type CountryCode } from '@crm/shared';

export interface PhoneParts {
  /** "0712 345 678" for Kenyan numbers, international format for foreign ones */
  national: string;
  /** "+254712345678" or null when the value is not a valid E.164 */
  e164: string | null;
  /** what was received, for numbers the PBX could not normalise (short codes, anonymous) */
  raw: string;
}

export function phoneParts(
  value: string | null | undefined,
  defaultCountry: CountryCode = 'KE',
): PhoneParts | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (isE164(trimmed)) return { national: formatNational(trimmed), e164: trimmed, raw: trimmed };
  const e164 = toE164(trimmed, defaultCountry);
  if (e164) return { national: formatNational(e164), e164, raw: trimmed };
  return { national: trimmed, e164: null, raw: trimmed };
}

/** Short display string for tables and popups. */
export function formatPhone(
  value: string | null | undefined,
  defaultCountry: CountryCode = 'KE',
): string {
  return phoneParts(value, defaultCountry)?.national ?? '';
}

export { normalizePhone };
