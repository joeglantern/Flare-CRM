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
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/x-wav',
  'video/mp4',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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
  opts: { prefix: string; allowed: Set<string>; maxBytes: number },
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
