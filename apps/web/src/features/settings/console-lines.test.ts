import { describe, expect, it } from 'vitest';
import { parseConsoleLines } from './console-lines';

describe('reading the lines the console prints for a new stack', () => {
  it('takes all four values from a pasted block, quotes and exports included', () => {
    const block = [
      '# Flare console',
      'CONSOLE_URL=https://console.example.com',
      'export CONSOLE_STACK_ID="stk_abcdefghijklmnopqrst"',
      "CONSOLE_STACK_SECRET='s3cret-s3cret-s3cret-s3cret-s3cret'",
      'CONSOLE_PUBLIC_KEY=MCowBQYDK2VwAyEAkey1=,MCowBQYDK2VwAyEAkey2=',
      'SOMETHING_ELSE=ignored',
    ].join('\n');
    expect(parseConsoleLines(block)).toEqual({
      consoleUrl: 'https://console.example.com',
      stackId: 'stk_abcdefghijklmnopqrst',
      stackSecret: 's3cret-s3cret-s3cret-s3cret-s3cret',
      publicKey: 'MCowBQYDK2VwAyEAkey1=',
    });
  });

  it('keeps the = signs inside a base64 key', () => {
    expect(parseConsoleLines('CONSOLE_PUBLIC_KEY=abc==').publicKey).toBe('abc==');
  });

  it('returns nothing for text that is not the console block', () => {
    expect(parseConsoleLines('hello\nworld')).toEqual({});
  });
});
