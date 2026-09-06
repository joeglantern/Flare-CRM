/**
 * In-app + email notifications (R-7.7). Preferences default per type; email goes through the
 * `email` queue so the request never waits on SMTP.
 */
import type { NotificationType } from '@crm/shared';
import { newId } from '../../lib/ids.js';
import type { EventBus } from '../../plugins/event-bus.js';
import type { Db } from '../../plugins/prisma.js';
import type { Queues } from '../../plugins/queues.js';
import { QUEUES } from '../../jobs/queues.js';

export const DEFAULT_PREFERENCES: Record<NotificationType, { inApp: boolean; email: boolean }> = {
  call_incoming: { inApp: true, email: false },
  call_missed: { inApp: true, email: false },
  message_new: { inApp: true, email: false },
  task_due: { inApp: true, email: true },
  task_assigned: { inApp: true, email: false },
  deal_stage: { inApp: true, email: false },
  mention: { inApp: true, email: true },
  system: { inApp: true, email: false },
};

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  data?: Record<string, unknown>;
}

export class NotificationsService {
  constructor(
    private readonly db: Db,
    private readonly queues: Queues,
    private readonly events: EventBus,
    private readonly appUrl: string,
  ) {}

  async preferencesFor(
    userId: string,
  ): Promise<Record<NotificationType, { inApp: boolean; email: boolean }>> {
    const rows = await this.db.notificationPreference.findMany({ where: { userId } });
    const out = { ...DEFAULT_PREFERENCES };
    for (const r of rows) {
      if (r.type in out) out[r.type as NotificationType] = { inApp: r.inApp, email: r.email };
    }
    return out;
  }

  async notify(input: NotifyInput): Promise<string | null> {
    const prefs = (await this.preferencesFor(input.userId))[input.type];
    let id: string | null = null;
    if (prefs.inApp) {
      id = newId();
      const row = await this.db.notification.create({
        data: {
          id,
          userId: input.userId,
          type: input.type,
          title: input.title,
          body: input.body ?? null,
          data: (input.data ?? {}) as object,
        },
      });
      this.events.emit('notification.created', {
        id,
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        data: input.data ?? {},
        createdAt: row.createdAt.toISOString(),
      });
    }
    if (prefs.email) {
      const user = await this.db.user.findUnique({
        where: { id: input.userId },
        select: { email: true, name: true, isActive: true },
      });
      if (user?.isActive) {
        const link =
          typeof input.data?.url === 'string' ? `${this.appUrl}${input.data.url}` : this.appUrl;
        await this.queues.add(QUEUES.email, input.type, {
          to: user.email,
          subject: input.title,
          text: `${input.body ?? input.title}\n\n${link}`,
          html: `<p>${escapeHtml(input.body ?? input.title)}</p><p><a href="${escapeHtml(link)}">Open in CRM</a></p>`,
        });
      }
    }
    return id;
  }

  async notifyMany(userIds: string[], input: Omit<NotifyInput, 'userId'>): Promise<void> {
    for (const userId of new Set(userIds)) await this.notify({ ...input, userId });
  }
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}
