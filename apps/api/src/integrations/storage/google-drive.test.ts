import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { GoogleDriveStorage, type DriveClient } from './google-drive.js';
import { memoryObjectStore } from './object-store.js';
import { RoutedStorage } from './routed.js';
import { MemoryStorage } from './storage.js';

function fakeDrive() {
  const files = new Map<string, { name: string; body: Buffer; type: string }>();
  let n = 0;
  const client: DriveClient = {
    ensureFolder: async (id) => {
      if (id !== 'folder') throw new Error('bad folder');
    },
    upload: async ({ name, body, contentType }) => {
      const id = `drive-${String(++n)}`;
      files.set(id, { name, body, type: contentType });
      return { id };
    },
    download: async (id, range) => {
      const f = files.get(id);
      if (!f) return null;
      if (range) {
        const m = /^bytes=(\d+)-(\d*)$/.exec(range);
        const start = Number(m?.[1] ?? 0);
        const end = m?.[2] ? Number(m[2]) : f.body.length - 1;
        const slice = f.body.subarray(start, end + 1);
        return {
          body: Readable.from(slice),
          contentType: f.type,
          contentLength: slice.length,
          contentRange: `bytes ${String(start)}-${String(end)}/${String(f.body.length)}`,
        };
      }
      return {
        body: Readable.from(f.body),
        contentType: 'application/octet-stream',
        contentLength: f.body.length,
        contentRange: undefined,
      };
    },
    remove: async (id) => {
      files.delete(id);
    },
  };
  return { client, files };
}

async function text(s: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of s) chunks.push(Buffer.from(c as Uint8Array));
  return Buffer.concat(chunks).toString();
}

describe('GoogleDriveStorage', () => {
  it('round-trips an object by key, keeping our sniffed content type', async () => {
    const { client, files } = fakeDrive();
    const s = new GoogleDriveStorage({ folderId: 'folder', client, objects: memoryObjectStore() });
    await s.ensureReady();
    const put = await s.put('recordings/2026/09/abc.wav', Buffer.from('hello audio'), 'audio/wav');
    expect(put.size).toBe(11);
    expect([...files.values()][0]?.name).toBe('recordings/2026/09/abc.wav');
    const got = await s.get('recordings/2026/09/abc.wav');
    expect(got?.contentType).toBe('audio/wav');
    expect(await text(got!.body)).toBe('hello audio');
    expect(await s.head('recordings/2026/09/abc.wav')).toEqual({
      size: 11,
      contentType: 'audio/wav',
    });
  });

  it('honours byte ranges so a player can seek', async () => {
    const { client } = fakeDrive();
    const s = new GoogleDriveStorage({ folderId: 'folder', client, objects: memoryObjectStore() });
    await s.put('recordings/x.wav', Buffer.from('0123456789'), 'audio/wav');
    const part = await s.get('recordings/x.wav', 'bytes=2-4');
    expect(await text(part!.body)).toBe('234');
    expect(part?.contentRange).toBe('bytes 2-4/10');
  });

  it('returns null for unknown keys and removes both file and row on delete', async () => {
    const { client, files } = fakeDrive();
    const objects = memoryObjectStore();
    const s = new GoogleDriveStorage({ folderId: 'folder', client, objects });
    expect(await s.get('recordings/missing.wav')).toBeNull();
    await s.put('recordings/y.wav', Buffer.from('x'), 'audio/wav');
    await s.delete('recordings/y.wav');
    expect(files.size).toBe(0);
    expect(await objects.get('recordings/y.wav')).toBeNull();
    expect(await s.presignGet()).toBeNull();
  });

  it('refuses a folder id that is not a folder', async () => {
    const { client } = fakeDrive();
    const s = new GoogleDriveStorage({ folderId: 'nope', client, objects: memoryObjectStore() });
    await expect(s.ensureReady()).rejects.toThrow(/bad folder/);
  });
});

describe('RoutedStorage', () => {
  it('sends listed prefixes to their backend and everything else to the fallback', async () => {
    const local = new MemoryStorage();
    const { client } = fakeDrive();
    const drive = new GoogleDriveStorage({
      folderId: 'folder',
      client,
      objects: memoryObjectStore(),
    });
    const routed = new RoutedStorage(local, [{ prefix: 'recordings', storage: drive }]);
    await routed.put('recordings/a.wav', Buffer.from('rec'), 'audio/wav');
    await routed.put('avatars/b.png', Buffer.from('img'), 'image/png');
    expect(await local.head('recordings/a.wav')).toBeNull();
    expect(await local.head('avatars/b.png')).not.toBeNull();
    expect(await drive.head('recordings/a.wav')).not.toBeNull();
    expect(await text((await routed.get('recordings/a.wav'))!.body)).toBe('rec');
  });
});
