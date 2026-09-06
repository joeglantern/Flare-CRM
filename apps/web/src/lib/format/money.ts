/**
 * Currency display. KES with thousands separators and the ISO code, never a symbol that could be
 * read as another currency (docs/18 sample data rules). Amounts arrive as numbers (major units).
 */
// Intl separates the code with a (narrow) no-break space; normalise for copy-paste and search
const NBSP_RE = new RegExp(`${String.fromCharCode(0xa0)}|${String.fromCharCode(0x202f)}`, 'g');
const formatters = new Map<string, Intl.NumberFormat>();

function formatterFor(currency: string, fractionDigits: number): Intl.NumberFormat {
  const key = `${currency}:${String(fractionDigits)}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat('en-KE', {
      style: 'currency',
      currency,
      currencyDisplay: 'code',
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
    formatters.set(key, f);
  }
  return f;
}

/** "KES 1,250,000" (whole units by default; pass fractionDigits 2 for invoices). */
export function formatMoney(
  amount: number | string | null | undefined,
  currency = 'KES',
  fractionDigits = 0,
): string {
  if (amount === null || amount === undefined || amount === '') return '';
  const value = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(value)) return '';
  // Intl puts a non-breaking space after the code; normalise to a regular space for copy-paste
  return formatterFor(currency, fractionDigits).format(value).replace(NBSP_RE, ' ');
}

/** Compact form for Kanban cards and chart labels: "KES 1.25M", "KES 50K". */
export function formatMoneyCompact(
  amount: number | string | null | undefined,
  currency = 'KES',
): string {
  if (amount === null || amount === undefined || amount === '') return '';
  const value = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(value)) return '';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  const compact =
    abs >= 1_000_000_000
      ? `${trimZeros((abs / 1_000_000_000).toFixed(2))}B`
      : abs >= 1_000_000
        ? `${trimZeros((abs / 1_000_000).toFixed(2))}M`
        : abs >= 1_000
          ? `${trimZeros((abs / 1_000).toFixed(1))}K`
          : String(Math.round(abs));
  return `${currency} ${sign}${compact}`;
}

function trimZeros(s: string): string {
  return s.replace(/\.?0+$/, '');
}
