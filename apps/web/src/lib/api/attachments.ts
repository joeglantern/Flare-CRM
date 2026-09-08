/**
 * Uploading a file happens before the thing it belongs to exists: the upload returns an id, and
 * whatever is saved next claims it. That is why this is a plain mutation rather than part of any
 * one feature's hooks, and why it uses fetch directly rather than the typed client, which does
 * not carry multipart bodies.
 */
import type { AttachmentDto } from '@crm/shared';
import { useMutation } from '@tanstack/react-query';
import { ApiError } from './errors';

export const MAX_ATTACHMENT_BYTES = 32 * 1024 * 1024;

export async function uploadAttachment(file: File): Promise<AttachmentDto> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new ApiError(
      413,
      'PAYLOAD_TOO_LARGE',
      `${file.name} is larger than 32 MB`,
      null,
      undefined,
    );
  }
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/v1/attachments', {
    method: 'POST',
    body: form,
    credentials: 'include',
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    throw new ApiError(
      res.status,
      body?.error?.code ?? 'UPLOAD_FAILED',
      body?.error?.message ?? `Could not upload ${file.name}`,
      null,
      undefined,
    );
  }
  return ((await res.json()) as { data: AttachmentDto }).data;
}

export function useUploadAttachment() {
  return useMutation({ mutationFn: uploadAttachment });
}

/** 1.4 MB rather than 1468006 bytes, which nobody can read at a glance. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit] ?? 'KB'}`;
}
