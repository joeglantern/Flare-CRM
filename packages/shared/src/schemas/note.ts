import { z } from 'zod';
import { isoDateTime, paginationCursor, uuid } from './common.js';
import { userRef } from './company.js';
import { attachmentDto } from './messaging.js';

export const noteDto = z.object({
  id: uuid,
  body: z.string(),
  author: userRef,
  authorId: uuid,
  contactId: uuid.nullable(),
  dealId: uuid.nullable(),
  companyId: uuid.nullable(),
  callId: uuid.nullable(),
  pinned: z.boolean(),
  attachments: z.array(attachmentDto),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type NoteDto = z.infer<typeof noteDto>;

export const createNoteBody = z
  .object({
    body: z.string().trim().min(1).max(20_000),
    contactId: uuid.optional(),
    dealId: uuid.optional(),
    companyId: uuid.optional(),
    callId: uuid.optional(),
    pinned: z.boolean().default(false),
    /** Ids from POST /attachments, bound to this note as it is created. */
    attachmentIds: z.array(uuid).max(10).optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.contactId !== undefined ||
      v.dealId !== undefined ||
      v.companyId !== undefined ||
      v.callId !== undefined,
    {
      message: 'A note must belong to a contact, deal, company or call',
      path: ['contactId'],
    },
  );
export type CreateNoteBody = z.infer<typeof createNoteBody>;

export const updateNoteBody = z
  .object({ body: z.string().trim().min(1).max(20_000).optional(), pinned: z.boolean().optional() })
  .strict();

export const listNotesQuery = paginationCursor.extend({
  contactId: uuid.optional(),
  dealId: uuid.optional(),
  companyId: uuid.optional(),
  callId: uuid.optional(),
});
