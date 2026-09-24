import type { NotificationDto } from '@crm/shared';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import { notificationHref } from './api';

const TASK_ID = '0192f1a4-7c3e-7d2a-9b1e-3f4a5b6c7d8e';

function notification(type: NotificationDto['type'], data: Record<string, unknown>) {
  return {
    id: '0192f1a4-0000-7000-8000-000000000001',
    type,
    title: 'A task',
    body: null,
    data,
    readAt: null,
    createdAt: '2026-09-24T10:00:00.000Z',
  } satisfies NotificationDto;
}

/** Follows a link the way the bell and the notification centre do, and says where it landed. */
async function land(href: string) {
  const root = createRootRoute();
  const tasks = createRoute({ getParentRoute: () => root, path: '/tasks' });
  const router = createRouter({
    routeTree: root.addChildren([tasks]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  await router.load();
  await router.navigate({ to: href as '/tasks' });
  return router.state.location;
}

describe('notificationHref for tasks', () => {
  it('opens the task a hand-back or an assignment is about', async () => {
    for (const type of ['task_assigned', 'task_declined', 'task_due'] as const) {
      const href = notificationHref(
        notification(type, { taskId: TASK_ID, url: `/tasks?taskId=${TASK_ID}` }),
      );
      expect(href).toBe(`/tasks?taskId=${TASK_ID}`);
      const at = await land(href ?? '');
      expect(at.pathname).toBe('/tasks');
      expect(at.search).toEqual({ taskId: TASK_ID });
    }
  });

  it('sends older notifications that pointed at /tasks/:id to the task instead', async () => {
    const href = notificationHref(
      notification('task_assigned', { taskId: TASK_ID, url: `/tasks/${TASK_ID}` }),
    );
    expect(href).toBe(`/tasks?taskId=${TASK_ID}`);
    expect((await land(href ?? '')).search).toEqual({ taskId: TASK_ID });
  });
});
