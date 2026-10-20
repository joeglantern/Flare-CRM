/**
 * "Chrome on Windows" from the browser's own user-agent text, for the audit log. Best effort: the
 * text is whatever the browser sent, so the full string stays one click away.
 */
const BROWSERS: [marker: string, name: string][] = [
  ['Edg/', 'Edge'],
  ['OPR/', 'Opera'],
  ['Firefox/', 'Firefox'],
  ['Chrome/', 'Chrome'],
  ['Safari/', 'Safari'],
];

const SYSTEMS: [markers: string[], name: string][] = [
  [['Android'], 'Android'],
  [['iPhone', 'iPad', 'iPod'], 'iPhone or iPad'],
  [['Windows'], 'Windows'],
  [['Mac OS X', 'Macintosh'], 'Mac'],
  [['CrOS'], 'Chromebook'],
  [['Linux'], 'Linux'],
];

export function describeUserAgent(ua: string | null | undefined): string {
  if (!ua) return 'Unknown';
  const browser =
    BROWSERS.find(([marker]) => ua.includes(marker))?.[1] ??
    (/curl|wget|python|node|axios|okhttp/i.test(ua) ? 'A script' : 'A browser');
  const system = SYSTEMS.find(([markers]) => markers.some((m) => ua.includes(m)))?.[1] ?? null;
  return system === null ? browser : `${browser} on ${system}`;
}
