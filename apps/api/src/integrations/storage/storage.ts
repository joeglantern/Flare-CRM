/**
 * Object storage abstraction (docs/02, docs/08 J2). Production: any S3-compatible endpoint
 * (SeaweedFS, Hetzner, B2, AWS). Tests: in-memory. Keys are always generated server-side.
 */
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHash, randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';

export interface PutResult {
  key: string;
  size: number;
  sha256: string;
}

export interface StoredObject {
  key: string;
  size: number;
  lastModified: string;
}

export interface ObjectStream {
  body: Readable;
  contentType: string;
  contentLength: number | undefined;
  contentRange: string | undefined;
}

export interface Storage {
  ensureReady(): Promise<void>;
  put(key: string, body: Buffer, contentType: string): Promise<PutResult>;
  get(key: string, range?: string): Promise<ObjectStream | null>;
  head(key: string): Promise<{ size: number; contentType: string } | null>;
  delete(key: string): Promise<void>;
  /** Newest first. Used where the store is its own catalogue, such as database snapshots. */
  list(prefix: string, limit?: number): Promise<StoredObject[]>;
  /** Presigned GET when the bucket host is reachable by browsers; otherwise null (stream through the API). */
  presignGet(key: string, ttlSeconds: number, downloadName?: string): Promise<string | null>;
}

/** Random, unguessable object keys under a prefix (docs/08 E6). */
export function newObjectKey(prefix: string, extension: string): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const ext = extension.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return `${prefix}/${yyyy}/${mm}/${randomBytes(16).toString('hex')}${ext ? `.${ext}` : ''}`;
}

export function sha256Of(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export interface S3StorageOptions {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  forcePathStyle: boolean;
  publicUrl: string | undefined;
}

export class S3Storage implements Storage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicUrl: string | undefined;

  constructor(private readonly opts: S3StorageOptions) {
    this.client = new S3Client({
      endpoint: opts.endpoint,
      region: opts.region,
      forcePathStyle: opts.forcePathStyle,
      credentials: { accessKeyId: opts.accessKey, secretAccessKey: opts.secretKey },
    });
    this.bucket = opts.bucket;
    this.publicUrl = opts.publicUrl;
  }

  async ensureReady(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404) {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        return;
      }
      throw err;
    }
  }

  async put(key: string, body: Buffer, contentType: string): Promise<PutResult> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentLength: body.length,
      }),
    );
    return { key, size: body.length, sha256: sha256Of(body) };
  }

  async get(key: string, range?: string): Promise<ObjectStream | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key, ...(range ? { Range: range } : {}) }),
      );
      if (!res.Body) return null;
      return {
        body: res.Body as Readable,
        contentType: res.ContentType ?? 'application/octet-stream',
        contentLength: res.ContentLength,
        contentRange: res.ContentRange,
      };
    } catch (err) {
      if ((err as { name?: string }).name === 'NoSuchKey') return null;
      throw err;
    }
  }

  async head(key: string): Promise<{ size: number; contentType: string } | null> {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return {
        size: res.ContentLength ?? 0,
        contentType: res.ContentType ?? 'application/octet-stream',
      };
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404) return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async list(prefix: string, limit = 100): Promise<StoredObject[]> {
    const res = await this.client.send(
      new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, MaxKeys: limit }),
    );
    return (res.Contents ?? [])
      .filter((o): o is { Key: string; Size?: number; LastModified?: Date } => Boolean(o.Key))
      .map((o) => ({
        key: o.Key,
        size: o.Size ?? 0,
        lastModified: (o.LastModified ?? new Date(0)).toISOString(),
      }))
      .sort((a, b) => b.lastModified.localeCompare(a.lastModified));
  }

  async presignGet(key: string, ttlSeconds: number, downloadName?: string): Promise<string | null> {
    if (!this.publicUrl) return null;
    const cmd = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ...(downloadName
        ? {
            ResponseContentDisposition: `attachment; filename="${downloadName.replace(/["\r\n]/g, '')}"`,
          }
        : {}),
    });
    const signed = await getSignedUrl(this.client, cmd, { expiresIn: ttlSeconds });
    // rewrite the internal endpoint host to the public one (same path/query/signature)
    const u = new URL(signed);
    const pub = new URL(this.publicUrl);
    u.protocol = pub.protocol;
    u.host = pub.host;
    return u.toString();
  }
}

/** In-memory storage for tests. */
export class MemoryStorage implements Storage {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();

  async ensureReady(): Promise<void> {
    return Promise.resolve();
  }
  async put(key: string, body: Buffer, contentType: string): Promise<PutResult> {
    this.objects.set(key, { body, contentType });
    return Promise.resolve({ key, size: body.length, sha256: sha256Of(body) });
  }
  async get(key: string, range?: string): Promise<ObjectStream | null> {
    const obj = this.objects.get(key);
    if (!obj) return Promise.resolve(null);
    const { Readable } = await import('node:stream');
    let slice = obj.body;
    let contentRange: string | undefined;
    const m = range ? /^bytes=(\d+)-(\d*)$/.exec(range) : null;
    if (m) {
      const start = Number(m[1]);
      const end = m[2] ? Math.min(Number(m[2]), obj.body.length - 1) : obj.body.length - 1;
      slice = obj.body.subarray(start, end + 1);
      contentRange = `bytes ${start}-${end}/${obj.body.length}`;
    }
    return {
      body: Readable.from(slice),
      contentType: obj.contentType,
      contentLength: slice.length,
      contentRange,
    };
  }
  async head(key: string) {
    const obj = this.objects.get(key);
    return Promise.resolve(obj ? { size: obj.body.length, contentType: obj.contentType } : null);
  }
  async delete(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }
  list(prefix: string, limit = 100): Promise<StoredObject[]> {
    return Promise.resolve(
      [...this.objects.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .slice(0, limit)
        .map(([key, v]) => ({ key, size: v.body.length, lastModified: new Date(0).toISOString() })),
    );
  }
  async presignGet(): Promise<string | null> {
    return Promise.resolve(null);
  }
}
