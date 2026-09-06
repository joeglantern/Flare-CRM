/**
 * Enumerations shared by api and web. Stored in PostgreSQL as text (see docs/05).
 * Keep values stable — they are persisted.
 */

export const Role = { admin: 'admin', manager: 'manager', agent: 'agent' } as const;
export type Role = (typeof Role)[keyof typeof Role];
export const ROLES = Object.values(Role);

export const AgentVisibility = { owned: 'owned', team: 'team', all: 'all' } as const;
export type AgentVisibility = (typeof AgentVisibility)[keyof typeof AgentVisibility];

export const CallDirection = {
  inbound: 'inbound',
  outbound: 'outbound',
  internal: 'internal',
} as const;
export type CallDirection = (typeof CallDirection)[keyof typeof CallDirection];

export const CallStatus = {
  ringing: 'ringing',
  answered: 'answered',
  completed: 'completed',
  missed: 'missed',
  busy: 'busy',
  failed: 'failed',
  voicemail: 'voicemail',
  abandoned: 'abandoned',
} as const;
export type CallStatus = (typeof CallStatus)[keyof typeof CallStatus];

export const RecordingStatus = {
  none: 'none',
  pending: 'pending',
  downloading: 'downloading',
  stored: 'stored',
  failed: 'failed',
} as const;
export type RecordingStatus = (typeof RecordingStatus)[keyof typeof RecordingStatus];

export const PhoneType = { mobile: 'mobile', work: 'work', home: 'home', other: 'other' } as const;
export type PhoneType = (typeof PhoneType)[keyof typeof PhoneType];

export const ContactSource = {
  manual: 'manual',
  import: 'import',
  webform: 'webform',
  call: 'call',
  chat: 'chat',
  api: 'api',
} as const;
export type ContactSource = (typeof ContactSource)[keyof typeof ContactSource];

export const LeadSource = {
  manual: 'manual',
  webform: 'webform',
  import: 'import',
  call: 'call',
  chat: 'chat',
} as const;
export type LeadSource = (typeof LeadSource)[keyof typeof LeadSource];

export const LeadStatus = {
  new: 'new',
  contacted: 'contacted',
  qualified: 'qualified',
  unqualified: 'unqualified',
  converted: 'converted',
} as const;
export type LeadStatus = (typeof LeadStatus)[keyof typeof LeadStatus];

export const DealStatus = { open: 'open', won: 'won', lost: 'lost' } as const;
export type DealStatus = (typeof DealStatus)[keyof typeof DealStatus];

export const StageType = { open: 'open', won: 'won', lost: 'lost' } as const;
export type StageType = (typeof StageType)[keyof typeof StageType];

export const TaskType = {
  call: 'call',
  meeting: 'meeting',
  follow_up: 'follow_up',
  email: 'email',
  other: 'other',
} as const;
export type TaskType = (typeof TaskType)[keyof typeof TaskType];

export const TaskStatus = {
  open: 'open',
  in_progress: 'in_progress',
  done: 'done',
  cancelled: 'cancelled',
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export const TaskPriority = { low: 'low', normal: 'normal', high: 'high' } as const;
export type TaskPriority = (typeof TaskPriority)[keyof typeof TaskPriority];

export const CustomFieldEntity = {
  contact: 'contact',
  company: 'company',
  deal: 'deal',
  lead: 'lead',
} as const;
export type CustomFieldEntity = (typeof CustomFieldEntity)[keyof typeof CustomFieldEntity];

export const CustomFieldType = {
  text: 'text',
  textarea: 'textarea',
  number: 'number',
  date: 'date',
  datetime: 'datetime',
  boolean: 'boolean',
  select: 'select',
  multiselect: 'multiselect',
  url: 'url',
  phone: 'phone',
  email: 'email',
} as const;
export type CustomFieldType = (typeof CustomFieldType)[keyof typeof CustomFieldType];

export const ChannelType = {
  whatsapp: 'whatsapp',
  sms: 'sms',
  livechat: 'livechat',
  yeastar: 'yeastar',
} as const;
export type ChannelType = (typeof ChannelType)[keyof typeof ChannelType];

export const ConversationStatus = { open: 'open', closed: 'closed', archived: 'archived' } as const;
export type ConversationStatus = (typeof ConversationStatus)[keyof typeof ConversationStatus];

export const MessageDirection = { inbound: 'inbound', outbound: 'outbound' } as const;
export type MessageDirection = (typeof MessageDirection)[keyof typeof MessageDirection];

export const MessageStatus = {
  queued: 'queued',
  sent: 'sent',
  delivered: 'delivered',
  read: 'read',
  failed: 'failed',
  received: 'received',
} as const;
export type MessageStatus = (typeof MessageStatus)[keyof typeof MessageStatus];

export const MessageContentType = {
  text: 'text',
  image: 'image',
  audio: 'audio',
  video: 'video',
  document: 'document',
  location: 'location',
  template: 'template',
  unsupported: 'unsupported',
} as const;
export type MessageContentType = (typeof MessageContentType)[keyof typeof MessageContentType];

export const ActivityType = {
  call: 'call',
  message: 'message',
  note: 'note',
  task_created: 'task_created',
  task_completed: 'task_completed',
  deal_created: 'deal_created',
  deal_stage: 'deal_stage',
  deal_won: 'deal_won',
  deal_lost: 'deal_lost',
  contact_created: 'contact_created',
  contact_updated: 'contact_updated',
  email: 'email',
  lead_converted: 'lead_converted',
} as const;
export type ActivityType = (typeof ActivityType)[keyof typeof ActivityType];

export const NotificationType = {
  call_incoming: 'call_incoming',
  call_missed: 'call_missed',
  message_new: 'message_new',
  task_due: 'task_due',
  task_assigned: 'task_assigned',
  deal_stage: 'deal_stage',
  mention: 'mention',
  system: 'system',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

export const AuditActorType = {
  user: 'user',
  system: 'system',
  pbx: 'pbx',
  webhook: 'webhook',
} as const;
export type AuditActorType = (typeof AuditActorType)[keyof typeof AuditActorType];

export const ImportEntity = { contact: 'contact', company: 'company', lead: 'lead' } as const;
export type ImportEntity = (typeof ImportEntity)[keyof typeof ImportEntity];

export const ImportStatus = {
  queued: 'queued',
  running: 'running',
  done: 'done',
  failed: 'failed',
} as const;
export type ImportStatus = (typeof ImportStatus)[keyof typeof ImportStatus];

/** Helper: turn a const object into a Zod-friendly tuple of its values. */
export function valuesOf<T extends Record<string, string>>(obj: T): [T[keyof T], ...T[keyof T][]] {
  const values = Object.values(obj) as T[keyof T][];
  const [first, ...rest] = values;
  if (first === undefined) throw new Error('enum object must not be empty');
  return [first, ...rest];
}
