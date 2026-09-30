/**
 * Reads the lines the owner console prints for a new stack (CONSOLE_URL=..., CONSOLE_STACK_ID=...,
 * CONSOLE_STACK_SECRET=..., CONSOLE_PUBLIC_KEY=...), so an admin can paste the block as it came
 * instead of copying four values one by one. Anything else in the paste is ignored.
 */
export interface ConsoleLinkValues {
  consoleUrl: string;
  stackId: string;
  stackSecret: string;
  publicKey: string;
}

const FIELDS: Record<string, keyof ConsoleLinkValues> = {
  CONSOLE_URL: 'consoleUrl',
  CONSOLE_STACK_ID: 'stackId',
  CONSOLE_STACK_SECRET: 'stackSecret',
  CONSOLE_PUBLIC_KEY: 'publicKey',
};

export function parseConsoleLines(text: string): Partial<ConsoleLinkValues> {
  const out: Partial<ConsoleLinkValues> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^export\s+/, '');
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const field = FIELDS[line.slice(0, eq).trim()];
    if (field === undefined) continue;
    let value = line.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    // The console may list more than one key while it rotates; the first is the one in use.
    if (field === 'publicKey') value = value.split(',')[0]?.trim() ?? '';
    if (value !== '') out[field] = value;
  }
  return out;
}
