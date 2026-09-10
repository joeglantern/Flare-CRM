/**
 * What the edit dialog sends. Kept out of the component because the payload is the part with a rule
 * in it: `PATCH /customers/:id` takes a partial, and the audit row records exactly what was sent, so
 * sending five fields when one changed writes a row that claims five things changed.
 *
 * An empty phone number is `null` rather than `''`, because "we do not have their number" and "their
 * number is the empty string" are different claims and only one of them is true.
 */
import type { Customer } from '@/lib/types';

export interface CustomerDraft {
  name: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  notes: string;
}

export type CustomerEditPayload = Partial<{
  name: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  notes: string;
}>;

export function draftFrom(customer: Customer): CustomerDraft {
  return {
    name: customer.name,
    contactName: customer.contactName,
    contactEmail: customer.contactEmail,
    contactPhone: customer.contactPhone ?? '',
    notes: customer.notes,
  };
}

function phone(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export function editPayload(customer: Customer, draft: CustomerDraft): CustomerEditPayload {
  const payload: CustomerEditPayload = {};
  if (draft.name.trim() !== customer.name) payload.name = draft.name.trim();
  if (draft.contactName.trim() !== customer.contactName) {
    payload.contactName = draft.contactName.trim();
  }
  if (draft.contactEmail.trim() !== customer.contactEmail) {
    payload.contactEmail = draft.contactEmail.trim();
  }
  if (phone(draft.contactPhone) !== customer.contactPhone) {
    payload.contactPhone = phone(draft.contactPhone);
  }
  if (draft.notes.trim() !== customer.notes) payload.notes = draft.notes.trim();
  return payload;
}

/** Whether Save has anything to do, which is the same question as "is the payload empty". */
export function hasChanges(customer: Customer, draft: CustomerDraft): boolean {
  return Object.keys(editPayload(customer, draft)).length > 0;
}

/** The three states the server accepts, and what each one actually does to that customer's CRM. */
export const CUSTOMER_STATUSES = ['active', 'suspended', 'churned'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export const STATUSES: Record<
  CustomerStatus,
  { label: string; short: string; consequences: string[] }
> = {
  active: {
    label: 'Active',
    short: 'Everything works normally.',
    consequences: [
      'Everyone at that business can read and change their CRM again',
      'The expiry date they had before being held is given back to them',
    ],
  },
  suspended: {
    label: 'Suspended',
    short: 'Reads keep working. Every change is refused.',
    consequences: [
      'Their people can still sign in and read everything they already have',
      'Every attempt to create, edit or delete anything is refused',
      'Nothing of theirs is deleted, and lifting the suspension puts it all back',
    ],
  },
  churned: {
    label: 'Churned',
    short: 'They have left. Records kept, nothing sold.',
    consequences: [
      'They stop counting towards revenue and the fleet totals',
      'Their CRM is held read only, exactly as a suspension holds it',
      'Nothing of theirs is deleted by this',
    ],
  },
};
