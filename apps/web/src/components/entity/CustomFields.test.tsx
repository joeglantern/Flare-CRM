/**
 * A datetime custom field could never be saved: the input's local wall-clock string went to the
 * server as it was, and the server wants an instant with an offset. Both directions are covered
 * so the value an agent sees is the value the server holds.
 */
import type { CustomFieldDefinitionDto } from '@crm/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { datetimeFromLocalInput, datetimeToLocalInput } from '@/lib/datetime-input';
import { CustomFieldInput } from './CustomFields';

const definition: CustomFieldDefinitionDto = {
  id: '01a00000-0000-7000-8000-0000000000aa',
  entity: 'contact',
  key: 'since',
  label: 'Customer since',
  type: 'datetime',
  options: null,
  required: true,
  isActive: true,
  sortOrder: 0,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

describe('datetime custom fields', () => {
  it('sends the server an instant with an offset for what the agent typed', () => {
    const onChange = vi.fn();
    render(<CustomFieldInput definition={definition} value={null} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/Customer since/), {
      target: { value: '2026-09-24T10:30' },
    });
    const sent = onChange.mock.calls[0]?.[0] as string;
    expect(sent).toMatch(/Z$/);
    expect(new Date(sent).getTime()).toBe(new Date('2026-09-24T10:30').getTime());
  });

  it('shows a stored instant as local time, and round-trips it unchanged', () => {
    const stored = '2026-09-24T07:30:00.000Z';
    const shown = datetimeToLocalInput(stored);
    expect(shown).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(datetimeFromLocalInput(shown)).toBe(stored);
  });

  it('clears to null rather than an empty string', () => {
    expect(datetimeFromLocalInput('')).toBeNull();
  });
});
