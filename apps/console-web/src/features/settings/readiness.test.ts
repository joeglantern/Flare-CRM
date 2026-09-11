/**
 * `/ready` is the one endpoint whose failures are its answers, so the cases worth pinning down are
 * all the ones where something went wrong: a 503, a body with no checks in it, a check that threw
 * rather than returning a detail, and a console that did not answer at all.
 *
 * If any of these came back as a thrown error, the settings screen would show "that did not load"
 * over a console that is telling us precisely what is wrong with it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { humanise, readReadiness, showValue } from './readiness';

const original = globalThis.fetch;

/** Answers /ready with a body and a status, the way the server does. */
function answer(body: unknown, status = 200) {
  globalThis.fetch = vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
}

afterEach(() => {
  globalThis.fetch = original;
});

describe('reading /ready', () => {
  it('reads the itemised answer a caller on the machine gets', async () => {
    answer({
      status: 'ready',
      ok: true,
      checks: {
        valkey: { ok: true },
        signing: { ok: true, detail: { keyId: '416b3e516755539b', algorithm: 'Ed25519' } },
        link: { ok: true, detail: { connectedStacks: 1 } },
      },
    });

    const result = await readReadiness();

    expect(result.ok).toBe(true);
    expect(result.reachable).toBe(true);
    expect(result.checks?.link?.detail).toEqual({ connectedStacks: 1 });
    expect(result.readAt).not.toBe('');
  });

  it('treats a 503 as an answer rather than as a failure to get one', async () => {
    answer(
      { status: 'degraded', ok: false, checks: { database: { ok: false, error: 'timed out' } } },
      503,
    );

    const result = await readReadiness();

    expect(result.reachable).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.status).toBe('degraded');
    // The message is the whole reason to look, so it has to survive parsing.
    expect(result.checks?.database?.error).toBe('timed out');
  });

  it('keeps the verdict when the server withholds the checks', async () => {
    // What a browser gets over a real hostname: /ready only itemises itself for a local caller.
    answer({ status: 'ready' });

    const result = await readReadiness();

    expect(result.reachable).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.checks).toBeNull();
  });

  it('says not ready when the console cannot be reached at all', async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error('connection refused')));

    const result = await readReadiness();

    expect(result.reachable).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.status).toBe('unreachable');
  });

  it('says not ready when something answers but not with JSON', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response('<html>502 Bad Gateway</html>', { status: 502 })),
    );

    const result = await readReadiness();

    expect(result.reachable).toBe(false);
    expect(result.ok).toBe(false);
  });

  it('never throws, whatever it is handed', async () => {
    answer(['not', 'an', 'object']);
    await expect(readReadiness()).resolves.toMatchObject({ ok: false });

    answer({ status: 'ready', ok: true, checks: { odd: 'not an object' } });
    const result = await readReadiness();
    expect(result.checks).toEqual({});
  });

  it('falls back to the HTTP status when the body does not carry a verdict', async () => {
    answer({ checks: { valkey: { ok: true } } }, 200);
    await expect(readReadiness()).resolves.toMatchObject({ ok: true, status: 'ready' });

    answer({ checks: { valkey: { ok: false } } }, 503);
    await expect(readReadiness()).resolves.toMatchObject({ ok: false, status: 'degraded' });
  });
});

describe('rendering an unknown check', () => {
  it('turns a detail key into something readable', () => {
    expect(humanise('connectedStacks')).toBe('Connected stacks');
    expect(humanise('keyId')).toBe('Key id');
    expect(humanise('valkey')).toBe('Valkey');
    expect(humanise('last_backup_at')).toBe('Last backup at');
  });

  it('shows a value of any shape without dropping it', () => {
    expect(showValue('Ed25519')).toBe('Ed25519');
    expect(showValue(1)).toBe('1');
    expect(showValue(true)).toBe('true');
    expect(showValue(null)).toBe('none');
    expect(showValue({ nested: 1 })).toBe('{"nested":1}');
  });
});
