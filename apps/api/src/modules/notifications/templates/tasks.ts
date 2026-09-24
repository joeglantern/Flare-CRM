/**
 * What a task says by email: that one was given to you, and that one you gave was handed back.
 *
 * Both carry the same four things a reader needs to act without opening the app first: the task,
 * when it is due, who did this and why. The layout and escaping live in `renderEmail`.
 */
import { emailDateTime, firstName, renderEmail, type EmailFact } from '@crm/shared';
import type { MailMessage } from '../../../plugins/mailer.js';
import type { Installation } from './auth.js';

export interface TaskMailTask {
  id: string;
  title: string;
  description: string | null;
  dueAt: Date | null;
  priority: string;
  /** The contact, deal or company the task is about, in words. Null when it stands alone. */
  about: string | null;
}

export interface TaskMailRecipient {
  email: string;
  name: string;
  timezone: string | null;
}

export function taskUrl(appUrl: string, taskId: string): string {
  return `${appUrl}/tasks?taskId=${encodeURIComponent(taskId)}`;
}

function dueText(task: TaskMailTask, timeZone: string | null): string {
  return task.dueAt === null ? 'No due date' : emailDateTime(task.dueAt, timeZone);
}

function taskFacts(task: TaskMailTask, timeZone: string | null): EmailFact[] {
  return [
    { label: 'Task', value: task.title },
    { label: 'Due', value: dueText(task, timeZone) },
    ...(task.priority === 'high' ? [{ label: 'Priority', value: 'High' }] : []),
    ...(task.about === null ? [] : [{ label: 'About', value: task.about }]),
  ];
}

export function taskAssignedEmail(input: {
  to: TaskMailRecipient;
  task: TaskMailTask;
  assignedBy: string;
  installation: Installation;
}): MailMessage {
  const place = input.installation.sender.name;
  const details = input.task.description?.trim() ?? '';
  const due = dueText(input.task, input.to.timezone);
  return renderEmail({
    to: input.to.email,
    subject: `Task for you: ${input.task.title}`,
    preheader: `${input.assignedBy} gave you a task. ${input.task.dueAt === null ? 'It has no due date.' : `It is due ${due}.`}`,
    heading: `${firstName(input.to.name)}, ${input.assignedBy} gave you a task.`,
    paragraphs: [
      `It is now on your task list in Flare${place === null ? '' : ` at ${place}`}.`,
      'If it should not be yours, open it and hand it back with a reason. It goes back to the person who gave it to you.',
    ],
    facts: [
      ...taskFacts(input.task, input.to.timezone),
      { label: 'Given by', value: input.assignedBy },
      ...(details === '' ? [] : [{ label: 'Details', value: details }]),
    ],
    button: { label: 'Open the task', url: taskUrl(input.installation.appUrl, input.task.id) },
    sign: place ?? 'Flare CRM',
    reason:
      'You received it because a task was assigned to you. You can turn these emails off in Preferences on the Notifications page.',
    sender: input.installation.sender,
  });
}

export function taskHandedBackEmail(input: {
  to: TaskMailRecipient;
  task: TaskMailTask;
  handedBackBy: string;
  note: string;
  installation: Installation;
}): MailMessage {
  const place = input.installation.sender.name;
  return renderEmail({
    to: input.to.email,
    subject: `Task handed back: ${input.task.title}`,
    preheader: `${input.handedBackBy} handed a task back to you and said why.`,
    heading: `${input.handedBackBy} handed a task back to you.`,
    paragraphs: [
      'The task is open and assigned to you again. Their reason is below, exactly as they wrote it.',
      'You can do it yourself, give it to someone else, or talk it over with them.',
    ],
    facts: [
      ...taskFacts(input.task, input.to.timezone),
      { label: 'Handed back by', value: input.handedBackBy },
      { label: 'Reason given', value: input.note },
    ],
    button: { label: 'Open the task', url: taskUrl(input.installation.appUrl, input.task.id) },
    sign: place ?? 'Flare CRM',
    reason:
      'You received it because you gave this task to someone and they handed it back. You can turn these emails off in Preferences on the Notifications page.',
    sender: input.installation.sender,
  });
}
