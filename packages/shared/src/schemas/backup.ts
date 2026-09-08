import { z } from 'zod';
import { isoDateTime } from './common.js';

/**
 * A database snapshot in the object store. `generated` was produced by the backup sidecar on its
 * schedule; `uploaded` was carried in from another server. Neither is restored by the application:
 * see the operator procedure in docs/13, which requires the stack to be stopped.
 *
 * The key is the identifier because the object store is the catalogue; there is no separate table
 * that could drift out of step with what is actually stored.
 */
export const backupOrigin = z.enum(['generated', 'uploaded']);

export const backupDto = z.object({
  key: z.string(),
  fileName: z.string(),
  sizeBytes: z.number().int(),
  createdAt: isoDateTime,
  origin: backupOrigin,
});
export type BackupDto = z.infer<typeof backupDto>;
