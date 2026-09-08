/**
 * Google Drive as an object store. Files are uploaded privately into one folder by a service
 * account and read back by id, so the key to id map lives in the database. Nothing is ever made
 * public in Drive: reads stream through the API's own authorised routes, byte ranges included,
 * which is what lets a recording seek in the browser.
 *
 * The Drive client is an interface so the backend is unit tested against a fake; the real one is
 * built by `createGoogleDriveClient` from a service account key file.
 */
import { Readable } from 'node:stream';
import { google } from 'googleapis';
import type { ObjectStore } from './object-store.js';
import { sha256Of, type ObjectStream, type PutResult, type Storage } from './storage.js';

export interface DriveClient {
  ensureFolder(folderId: string): Promise<void>;
  upload(input: {
    folderId: string;
    name: string;
    contentType: string;
    body: Buffer;
    appProperties: Record<string, string>;
  }): Promise<{ id: string }>;
  download(fileId: string, range?: string): Promise<ObjectStream | null>;
  remove(fileId: string): Promise<void>;
}

export const DRIVE_PROVIDER = 'gdrive';

export class GoogleDriveStorage implements Storage {
  constructor(
    private readonly opts: { folderId: string; client: DriveClient; objects: ObjectStore },
  ) {}

  async ensureReady(): Promise<void> {
    await this.opts.client.ensureFolder(this.opts.folderId);
  }

  async put(key: string, body: Buffer, contentType: string): Promise<PutResult> {
    const sha256 = sha256Of(body);
    const { id } = await this.opts.client.upload({
      folderId: this.opts.folderId,
      // The key doubles as the file name so the folder stays legible in the Drive UI and a lost
      // database row can still be reconciled by hand.
      name: key,
      contentType,
      body,
      appProperties: { key, sha256 },
    });
    await this.opts.objects.put({
      key,
      provider: DRIVE_PROVIDER,
      providerId: id,
      size: body.length,
      contentType,
      sha256,
    });
    return { key, size: body.length, sha256 };
  }

  async get(key: string, range?: string): Promise<ObjectStream | null> {
    const row = await this.opts.objects.get(key);
    if (row?.provider !== DRIVE_PROVIDER) return null;
    const stream = await this.opts.client.download(row.providerId, range);
    if (!stream) return null;
    // Drive reports the type it inferred at upload; ours is authoritative, it was sniffed.
    return { ...stream, contentType: row.contentType };
  }

  async head(key: string): Promise<{ size: number; contentType: string } | null> {
    const row = await this.opts.objects.get(key);
    if (row?.provider !== DRIVE_PROVIDER) return null;
    return { size: row.size, contentType: row.contentType };
  }

  async delete(key: string): Promise<void> {
    const row = await this.opts.objects.get(key);
    if (row?.provider === DRIVE_PROVIDER) await this.opts.client.remove(row.providerId);
    await this.opts.objects.delete(key);
  }

  /** Drive has no signed URLs, and its share links would make the file public. Always stream. */
  presignGet(): Promise<string | null> {
    return Promise.resolve(null);
  }
}

export function createGoogleDriveClient(opts: {
  keyFile: string;
  impersonate?: string | undefined;
}): DriveClient {
  const auth = new google.auth.JWT({
    keyFile: opts.keyFile,
    scopes: ['https://www.googleapis.com/auth/drive'],
    ...(opts.impersonate ? { subject: opts.impersonate } : {}),
  });
  const drive = google.drive({ version: 'v3', auth });
  const shared = { supportsAllDrives: true } as const;

  return {
    async ensureFolder(folderId) {
      const res = await drive.files.get({ fileId: folderId, fields: 'id,mimeType', ...shared });
      if (res.data.mimeType !== 'application/vnd.google-apps.folder')
        throw new Error('GDRIVE_FOLDER_ID is not a folder');
    },
    async upload({ folderId, name, contentType, body, appProperties }) {
      const res = await drive.files.create({
        requestBody: { name, parents: [folderId], mimeType: contentType, appProperties },
        media: { mimeType: contentType, body: Readable.from(body) },
        fields: 'id',
        ...shared,
      });
      if (!res.data.id) throw new Error('Drive upload returned no file id');
      return { id: res.data.id };
    },
    async download(fileId, range) {
      try {
        const res = await drive.files.get(
          { fileId, alt: 'media', ...shared },
          { responseType: 'stream', headers: range ? { Range: range } : {} },
        );
        const h = res.headers as Record<string, string | undefined>;
        const len = h['content-length'];
        return {
          body: res.data,
          contentType: h['content-type'] ?? 'application/octet-stream',
          contentLength: len !== undefined ? Number(len) : undefined,
          contentRange: res.status === 206 ? h['content-range'] : undefined,
        };
      } catch (err) {
        if ((err as { code?: number }).code === 404) return null;
        throw err;
      }
    },
    async remove(fileId) {
      try {
        await drive.files.delete({ fileId, ...shared });
      } catch (err) {
        if ((err as { code?: number }).code !== 404) throw err;
      }
    },
  };
}
