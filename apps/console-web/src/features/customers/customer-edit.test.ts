/**
 * The payload is the part of the edit dialog with a rule in it. `PATCH /customers/:id` takes a
 * partial and the audit row records exactly what was sent, so a dialog that always sends five
 * fields writes a row claiming five things changed every time one of them did.
 */
import { describe, expect, it } from 'vitest';
import type { Customer } from '@/lib/types';
import { draftFrom, editPayload, hasChanges } from './customer-edit';

const customer: Customer = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Acme Ltd',
  slug: 'acme',
  status: 'active',
  contactName: 'Jane Doe',
  contactEmail: 'jane@acme.example',
  contactPhone: '+254700000000',
  notes: 'Invoiced yearly.',
  primaryDomain: 'acme.raniafrica.co.ke',
  customDomain: null,
  customDomainVerifiedAt: null,
  createdAt: '2026-09-01T00:00:00.000Z',
};

describe('the customer edit payload', () => {
  it('sends nothing at all when nothing was touched', () => {
    const draft = draftFrom(customer);
    expect(editPayload(customer, draft)).toEqual({});
    expect(hasChanges(customer, draft)).toBe(false);
  });

  it('sends only the field that changed', () => {
    const draft = { ...draftFrom(customer), contactName: 'John Doe' };
    expect(editPayload(customer, draft)).toEqual({ contactName: 'John Doe' });
  });

  it('sends a cleared phone number as null rather than as an empty string', () => {
    const draft = { ...draftFrom(customer), contactPhone: '   ' };
    expect(editPayload(customer, draft)).toEqual({ contactPhone: null });
  });

  it('treats a phone number that was already missing as unchanged when left empty', () => {
    const without = { ...customer, contactPhone: null };
    expect(editPayload(without, draftFrom(without))).toEqual({});
  });

  it('trims what it sends, and says nothing changed when only whitespace did', () => {
    const draft = { ...draftFrom(customer), name: '  Acme Ltd  ', notes: 'Invoiced yearly.  ' };
    expect(editPayload(customer, draft)).toEqual({});
    expect(hasChanges(customer, draft)).toBe(false);
  });

  it('carries several fields when several changed', () => {
    const draft = {
      ...draftFrom(customer),
      name: 'Acme Kenya Ltd',
      contactEmail: 'accounts@acme.example',
      notes: '',
    };
    expect(editPayload(customer, draft)).toEqual({
      name: 'Acme Kenya Ltd',
      contactEmail: 'accounts@acme.example',
      notes: '',
    });
  });

  it('never sends the status, which has its own control and its own confirmation', () => {
    const draft = { ...draftFrom(customer), name: 'Acme Kenya Ltd' };
    expect(editPayload(customer, draft)).not.toHaveProperty('status');
  });
});
