import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext, type TestUser } from '../setup/test-app.js';

interface Envelope<T> {
  data: T;
}

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

// A pg_dump custom-format archive starts with the five bytes "PGDMP"; the rest is irrelevant here.
const DUMP = Buffer.concat([Buffer.from('PGDMP'), Buffer.from('fake archive body')]);

describe('backups: the object store is the catalogue, the application never runs pg_dump', () => {
  let ctx: TestContext;
  let admin: TestUser;

  beforeAll(async () => {
    ctx = await TestContext.create();
  });
  beforeEach(async () => {
    await ctx.reset();
    admin = await ctx.createUser({ role: 'admin' });
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('uploads, lists, downloads and deletes a snapshot', async () => {
    const empty = await ctx.as(admin, { method: 'GET', url: '/api/v1/backups' });
    expect(empty.statusCode, empty.body).toBe(200);
    expect(empty.json<Envelope<unknown[]>>().data).toEqual([]);

    const up = await ctx.as(admin, {
      method: 'POST',
      url: '/api/v1/backups/upload',
      ...multipart('file', 'crm.dump', 'application/octet-stream', DUMP),
    });
    expect(up.statusCode, up.body).toBe(201);
    const uploaded =
      up.json<Envelope<{ key: string; fileName: string; sizeBytes: number; origin: string }>>()
        .data;
    expect(uploaded.origin).toBe('uploaded');
    expect(uploaded.sizeBytes).toBe(DUMP.length);
    expect(uploaded.key).toMatch(/^backups\/upload-/);

    const list = await ctx.as(admin, { method: 'GET', url: '/api/v1/backups' });
    const rows = list.json<Envelope<{ key: string }[]>>().data;
    expect(rows.map((r) => r.key)).toEqual([uploaded.key]);

    const dl = await ctx.as(admin, {
      method: 'GET',
      url: `/api/v1/backups/download?key=${encodeURIComponent(uploaded.key)}`,
    });
    expect(dl.statusCode, dl.body).toBe(200);
    expect(dl.rawPayload.equals(DUMP)).toBe(true);
    expect(dl.headers['content-disposition']).toContain(uploaded.fileName);

    const del = await ctx.as(admin, {
      method: 'DELETE',
      url: `/api/v1/backups?key=${encodeURIComponent(uploaded.key)}`,
    });
    expect(del.statusCode, del.body).toBe(204);
    expect(
      (await ctx.as(admin, { method: 'GET', url: '/api/v1/backups' })).json<Envelope<unknown[]>>()
        .data,
    ).toEqual([]);
    const gone = await ctx.as(admin, {
      method: 'GET',
      url: `/api/v1/backups/download?key=${encodeURIComponent(uploaded.key)}`,
    });
    expect(gone.statusCode).toBe(404);
  });

  it('refuses a file that is not a pg_dump archive, and keys outside backups/', async () => {
    const notADump = await ctx.as(admin, {
      method: 'POST',
      url: '/api/v1/backups/upload',
      ...multipart('file', 'notes.txt', 'text/plain', Buffer.from('just some text')),
    });
    expect(notADump.statusCode).toBe(422);

    const traversal = await ctx.as(admin, {
      method: 'GET',
      url: `/api/v1/backups/download?key=${encodeURIComponent('backups/../secrets/postgres_password')}`,
    });
    expect(traversal.statusCode).toBe(422);

    const wrongPrefix = await ctx.as(admin, {
      method: 'GET',
      url: `/api/v1/backups/download?key=${encodeURIComponent('avatars/someone.png')}`,
    });
    expect(wrongPrefix.statusCode).toBe(422);
  });

  it('is restricted to settings:manage, which only admin holds', async () => {
    const agent = await ctx.createUser({ role: 'agent' });
    const manager = await ctx.createUser({ role: 'manager' });
    for (const user of [agent, manager]) {
      const res = await ctx.as(user, { method: 'GET', url: '/api/v1/backups' });
      expect(res.statusCode).toBe(403);
    }
  });
});
