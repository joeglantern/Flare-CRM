/**
 * Typed in-process domain event bus (docs/03 §2, docs/14 §2). Modules react to each other
 * through events, never by importing each other's services.
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

export interface DomainEvents {
  'entity.changed': { type: string; id: string; updatedAt: string; byUserId: string | null };
  'contact.created': { contactId: string; byUserId: string | null; linkCallId: string | undefined };
  'contact.merged': { targetId: string; sourceId: string; byUserId: string };
  'deal.stage_changed': {
    dealId: string;
    title: string;
    fromStage: string | null;
    toStage: string;
    status: string;
    ownerId: string | null;
    byUserId: string | null;
  };
  'task.created': {
    taskId: string;
    assigneeId: string | null;
    byUserId: string | null;
    remindAt: string | null;
  };
  'task.updated': {
    taskId: string;
    assigneeId: string | null;
    remindAt: string | null;
    status: string;
  };
  'task.completed': { taskId: string; assigneeId: string | null; byUserId: string | null };
  'notification.created': {
    id: string;
    userId: string;
    type: string;
    title: string;
    body: string | null;
    data: Record<string, unknown>;
    createdAt: string;
  };
  'user.extension_changed': { userId: string };
}

type Handler<E extends keyof DomainEvents> = (payload: DomainEvents[E]) => void | Promise<void>;

export class EventBus {
  private readonly handlers = new Map<keyof DomainEvents, Handler<never>[]>();

  constructor(private readonly log: { error: (o: unknown, m: string) => void }) {}

  on<E extends keyof DomainEvents>(event: E, handler: Handler<E>): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  /** Fire-and-forget; handler failures are logged and never propagate to the request. */
  emit<E extends keyof DomainEvents>(event: E, payload: DomainEvents[E]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      try {
        const result = (handler as Handler<E>)(payload);
        if (result instanceof Promise) {
          result.catch((err: unknown) => {
            this.log.error({ err, event }, 'event handler failed');
          });
        }
      } catch (err) {
        this.log.error({ err, event }, 'event handler threw');
      }
    }
  }
}

export default fp(
  function eventBusPlugin(app: FastifyInstance) {
    app.decorate('events', new EventBus(app.log));
  },
  { name: 'event-bus' },
);
