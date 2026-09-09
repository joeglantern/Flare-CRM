/**
 * Upload handling (docs/08 E6): sniff real MIME type, enforce allowlists and size, random keys.
 */
import type { MultipartFile } from '@fastify/multipart';
import { fileTypeFromBuffer } from 'file-type';
import type { Storage } from '../integrations/storage/storage.js';
import { newObjectKey } from '../integrations/storage/storage.js';
import { BadRequestError, ValidationError } from './errors.js';

export const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
export const ATTACHMENT_TYPES = new Set([
  // images
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/tiff',
  'image/heic',
  'image/avif',
  // deliberately not image/svg+xml: an SVG is a script container
  // audio
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/x-wav',
  'audio/aac',
  'audio/mp4',
  'audio/webm',
  'audio/flac',
  'audio/amr',
  // video
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-matroska',
  'video/3gpp',
  // documents
  'application/pdf',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/rtf',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  // bundles of the above; served as a download, never executed
  'application/zip',
]);
const TEXT_TYPES = new Set(['text/plain', 'text/csv']);

export interface StoredUpload {
  key: string;
  fileName: string;
  mimeType: string;
  size: number;
  sha256: string;
}

export async function storeUpload(
  storage: Storage,
  file: MultipartFile | undefined,
  opts: {
    prefix: string;
    allowed: Set<string>;
    maxBytes: number;
    /** Runs once the bytes are known and before anything is written; throw to refuse. */
    beforeStore?: (bytes: number) => Promise<void>;
  },
): Promise<StoredUpload> {
  if (!file) throw new BadRequestError('A file is required');
  const buffer = await file.toBuffer();
  if (buffer.length === 0) throw new ValidationError([{ path: 'file', message: 'File is empty' }]);
  if (buffer.length > opts.maxBytes)
    throw new ValidationError([
      { path: 'file', message: `File exceeds ${Math.round(opts.maxBytes / 1024 / 1024)} MiB` },
    ]);

  const sniffed = await fileTypeFromBuffer(buffer);
  let mimeType = sniffed?.mime;
  if (!mimeType) {
    // file-type cannot detect plain text; accept the declared type only for text formats we allow
    const declared = file.mimetype.split(';')[0]?.trim() ?? '';
    if (TEXT_TYPES.has(declared) && opts.allowed.has(declared) && looksLikeText(buffer))
      mimeType = declared;
  }
  if (!mimeType || !opts.allowed.has(mimeType)) {
    throw new ValidationError([
      { path: 'file', message: `Unsupported file type${mimeType ? ` (${mimeType})` : ''}` },
    ]);
  }
  const ext = sniffed?.ext ?? (mimeType === 'text/csv' ? 'csv' : 'txt');
  if (opts.beforeStore) await opts.beforeStore(buffer.length);
  const key = newObjectKey(opts.prefix, ext);
  const result = await storage.put(key, buffer, mimeType);
  return {
    key,
    fileName: sanitizeFileName(file.filename),
    mimeType,
    size: result.size,
    sha256: result.sha256,
  };
}

function looksLikeText(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 4096);
  for (const byte of sample) {
    if (byte === 0) return false;
  }
  return true;
}

export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  return base.replace(/[^\w.\- ()]/g, '_').slice(0, 150) || 'file';
}
