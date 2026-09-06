import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MemoryStorage } from '../../src/integrations/storage/storage.js';
import { TestContext, type TestUser } from '../setup/test-app.js';

interface Envelope<T> {
  data: T;
}

// 1×1 transparent PNG (file-type sniffs the signature; content is irrelevant)
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

function multipart(field: string, fileName: string, mimeType: string, body: Buffer) {
  const boundary = `----crm-test-${String(Date.now())}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${fileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, body, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

describe('uploads: avatars are sniffed, stored and served', () => {
  let ctx: TestContext;
  let agent: TestUser;
  let storage: MemoryStorage;

  beforeAll(async () => {
    ctx = await TestContext.create();
    storage = ctx.app.storage as MemoryStorage;
  });
  beforeEach(async () => {
    await ctx.reset();
    agent = await ctx.createUser({ role: 'agent' });
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('sets, serves, replaces and removes the current user avatar', async () => {
    const up = await ctx.as(agent, {
      method: 'POST',
      url: '/api/v1/users/me/avatar',
      ...multipart('file', 'me.png', 'image/png', PNG),
    });
    expect(up.statusCode, up.body).toBe(200);
    const first = up.json<Envelope<{ avatarUrl: string | null }>>().data.avatarUrl;
    expect(first).toMatch(/^\/api\/v1\/files\/avatars/);

    const served = await ctx.as(agent, { method: 'GET', url: first! });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.rawPayload.equals(PNG)).toBe(true);

    // replacing deletes the previous object
    const again = await ctx.as(agent, {
      method: 'POST',
      url: '/api/v1/users/me/avatar',
      ...multipart('file', 'me2.png', 'image/png', PNG),
    });
    const second = again.json<Envelope<{ avatarUrl: string | null }>>().data.avatarUrl;
    expect(second).not.toBe(first);
    expect(storage.objects.size).toBe(1);

    const removed = await ctx.as(agent, { method: 'DELETE', url: '/api/v1/users/me/avatar' });
    expect(removed.json<Envelope<{ avatarUrl: string | null }>>().data.avatarUrl).toBeNull();
    expect(storage.objects.size).toBe(0);
    expect(
      await ctx.app.db.auditLog.count({
        where: { action: { in: ['user.avatar_set', 'user.avatar_removed'] } },
      }),
    ).toBe(3);
  });

  it('rejects files whose real content is not an allowed image, whatever the declared type', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    const spoofed = await ctx.as(agent, {
      method: 'POST',
      url: '/api/v1/users/me/avatar',
      ...multipart('file', 'x.png', 'image/png', svg),
    });
    expect(spoofed.statusCode).toBe(422);
    expect(spoofed.body).toContain('Unsupported file type');
    const empty = await ctx.as(agent, {
      method: 'POST',
      url: '/api/v1/users/me/avatar',
      ...multipart('file', 'x.png', 'image/png', Buffer.alloc(0)),
    });
    expect(empty.statusCode).toBe(422);
    expect(storage.objects.size).toBe(0);
    const anon = await ctx.as(null, {
      method: 'POST',
      url: '/api/v1/users/me/avatar',
      ...multipart('file', 'x.png', 'image/png', PNG),
    });
    expect(anon.statusCode).toBe(401);
  });
});
