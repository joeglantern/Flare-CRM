/**
 * Queue names and job payload types (docs/04 naming: `domain.action`). Shared by producers (api)
 * and processors (worker).
 */
import type { MailMessage } from '../plugins/mailer.js';

export const QUEUES = {
  email: 'email',
  taskReminder: 'task.reminder',
  recordingDownload: 'recording.download',
  ctiEvent: 'cti.event',
  ctiReconcile: 'cti.reconcile',
  messagingInbound: 'messaging.inbound',
  messagingOutbound: 'messaging.outbound',
  csvImport: 'csv.import',
  retention: 'retention',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface JobPayloads {
  [QUEUES.email]: MailMessage;
  [QUEUES.taskReminder]: { taskId: string };
  [QUEUES.recordingDownload]: { callId: string; fileName: string };
  [QUEUES.ctiEvent]: { raw: unknown; source: 'webhook' | 'websocket'; receivedAt: string };
  [QUEUES.ctiReconcile]: { since?: string };
  [QUEUES.messagingInbound]: { channelId: string; payload: unknown };
  [QUEUES.messagingOutbound]: { messageId: string };
  [QUEUES.csvImport]: { importJobId: string };
  [QUEUES.retention]: Record<string, never>;
}

export const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: { age: 60 * 60 * 24, count: 5_000 },
  removeOnFail: { age: 60 * 60 * 24 * 14 },
};
