import type { TaskDto } from '@crm/shared';
import { describe, expect, it } from 'vitest';
import { handBackTarget } from './hand-back';

const ME = { id: '0192f1a4-0000-7000-8000-00000000000a', name: 'Wanjiru Kamau' };
const BOSS = { id: '0192f1a4-0000-7000-8000-00000000000b', name: 'Otieno Achieng' };
const PEER = { id: '0192f1a4-0000-7000-8000-00000000000c', name: 'Amina Hassan' };

function task(patch: Partial<TaskDto>): TaskDto {
  return {
    id: '0192f1a4-0000-7000-8000-000000000100',
    title: 'Call back about the quote',
    description: null,
    type: 'call',
    status: 'open',
    priority: 'normal',
    dueAt: null,
    remindAt: null,
    reminderSentAt: null,
    assignee: ME,
    assigneeId: ME.id,
    contact: null,
    contactId: null,
    deal: null,
    dealId: null,
    company: null,
    companyId: null,
    sourceCallId: null,
    completedAt: null,
    createdBy: BOSS,
    assignedBy: null,
    handBackTo: BOSS,
    handedBack: null,
    createdAt: '2026-09-24T08:00:00.000Z',
    updatedAt: '2026-09-24T08:00:00.000Z',
    ...patch,
  };
}

describe('handBackTarget', () => {
  it('returns the task to the person the server says gave it', () => {
    expect(handBackTarget(task({ handBackTo: PEER }), ME.id)).toEqual(PEER);
    expect(handBackTarget(task({}), ME.id)).toEqual(BOSS);
  });

  it('offers nothing on a task you made yourself, someone else holds, or is closed', () => {
    expect(handBackTarget(task({ handBackTo: null }), ME.id)).toBeNull();
    expect(handBackTarget(task({ handBackTo: ME }), ME.id)).toBeNull();
    expect(handBackTarget(task({ assigneeId: PEER.id, assignee: PEER }), ME.id)).toBeNull();
    expect(handBackTarget(task({ status: 'done' }), ME.id)).toBeNull();
    expect(handBackTarget(task({ status: 'cancelled' }), ME.id)).toBeNull();
  });
});
