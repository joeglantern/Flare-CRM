/**
 * Who the provider is, as it travels inside every issued document so a customer knows who to call.
 *
 * It lives in console settings rather than in the environment because an owner can change it from
 * the Settings screen, and the next document carries the new answer.
 */
import { ownerContact as ownerContactSchema, type OwnerContact } from '@crm/shared';
import type { Db } from '../plugins/prisma.js';

export const OWNER_CONTACT_KEY = 'ownerContact';

/** Used when the setting has never been written, or has been written into something unreadable. */
export const FALLBACK_OWNER_CONTACT: OwnerContact = {
  name: 'Your provider',
  email: 'support@example.com',
};

export async function readOwnerContact(db: Db): Promise<OwnerContact> {
  const row = await db.consoleSetting.findUnique({ where: { key: OWNER_CONTACT_KEY } });
  const parsed = ownerContactSchema.safeParse(row?.value);
  return parsed.success ? parsed.data : FALLBACK_OWNER_CONTACT;
}
