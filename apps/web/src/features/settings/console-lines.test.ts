import { describe, expect, it } from 'vitest';
import { linkChanges, parseConsoleLines } from './console-lines';

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

describe('what an edit changes about an existing link', () => {
  const current = { stackId: 'stk_abcdefghijklmnopqrst', publicKeys: ['MCowBQYDK2VwAyEAkey1='] };
  const same = {
    consoleUrl: '',
    stackId: 'stk_abcdefghijklmnopqrst',
    stackSecret: 'n'.repeat(40),
    publicKey: 'MCowBQYDK2VwAyEAkey1=',
  };

  it('is nothing when only the secret is replaced', () => {
    expect(linkChanges(current, same)).toEqual([]);
  });

  it('names the address, the stack id and the key, each when it differs', () => {
    expect(linkChanges(current, { ...same, consoleUrl: 'https://other.example.com' })).toHaveLength(
      1,
    );
    expect(linkChanges(current, { ...same, stackId: 'stk_zzzzzzzzzzzzzzzzzzzz' })).toHaveLength(1);
    expect(
      linkChanges(current, {
        consoleUrl: 'https://other.example.com',
        stackId: 'stk_zzzzzzzzzzzzzzzzzzzz',
        stackSecret: '',
        publicKey: 'MCowBQYDK2VwAyEAkey2=',
      }),
    ).toHaveLength(3);
  });

  it('has nothing to compare on a first link', () => {
    expect(linkChanges({ stackId: null, publicKeys: [] }, same)).toEqual([]);
  });
});
