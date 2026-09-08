/**
 * Shared limit for snapshot handling. A snapshot is read into memory before it is stored, so it is
 * capped; past this the sidecar's off-site path is the right tool and the upload says so instead of
 * exhausting the server.
 */
export const MAX_BACKUP_BYTES = 512 * 1024 * 1024;
