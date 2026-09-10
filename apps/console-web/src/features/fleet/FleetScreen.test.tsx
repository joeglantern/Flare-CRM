/**
 * The fleet is the screen an owner leaves open, so the thing worth testing is that it changes on its
 * own: a stack that reconnects turns live, and its seat and storage figures follow, without the
 * screen asking the server anything.
 */
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ConsoleServerPayload } from '@crm/shared';
import { getSocket } from '@/lib/socket';
import type { FleetRow } from '@/lib/types';
import { renderWithRouter, stubFetch, type FetchStub } from '@/test/render';
import { FleetScreen } from './FleetScreen';

const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';
const STACK_ID = 'stk_abcdefghijklmnopqrst';

const row: FleetRow = {
  customer: {
    id: CUSTOMER_ID,
    name: 'Acme Ltd',
    slug: 'acme',
    status: 'active',
    contactName: 'Jane Doe',
    contactEmail: 'jane@acme.example',
    contactPhone: null,
    notes: '',
    primaryDomain: 'acme.raniafrica.co.ke',
    customDomain: null,
    customDomainVerifiedAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
  },
  plan: { id: 'plan-1', name: 'Standard' },
  expiresAt: null,
  stacks: [
    {
      id: STACK_ID,
      label: 'primary',
      connected: false,
      lastSeenAt: null,
      version: null,
      domain: null,
      lastBackupAt: null,
      revokedAt: null,
      currentIssueId: null,
      usage: null,
      health: null,
    },
  ],
  connected: false,
  seats: { used: null, max: 10 },
  storageBytes: null,
  lastSeenAt: null,
  lastBackupAt: null,
  version: null,
};

const heartbeat: ConsoleServerPayload<'fleet:stack'> = {
  at: '2026-09-10T10:00:00.000Z',
  customerId: CUSTOMER_ID,
  stackId: STACK_ID,
  connected: true,
  lastSeenAt: '2026-09-10T10:00:00.000Z',
  version: 'abc1234',
  usage: {
    seatsActive: 4,
    storageBytes: 5 * 1024 * 1024,
    attachmentsBytes: 4 * 1024 * 1024,
    recordingsBytes: 1024 * 1024,
    backupsBytes: 0,
  },
  readyOk: true,
  lastBackupAt: '2026-09-10T02:00:00.000Z',
};

let fetchStub: FetchStub | null = null;

/** Delivers an event the way the server does: to the handlers the screen registered. */
function deliver(event: 'fleet:stack', payload: ConsoleServerPayload<'fleet:stack'>): void {
  const listeners = getSocket().listeners(event);
  expect(listeners.length).toBeGreaterThan(0);
  act(() => {
    for (const listener of listeners) listener(payload);
  });
}

afterEach(() => {
  fetchStub?.restore();
  fetchStub = null;
  getSocket().removeAllListeners('fleet:stack');
});

describe('the fleet screen', () => {
  it('lists customers with what their stack last reported', async () => {
    fetchStub = stubFetch({ 'GET /api/v1/fleet': [row] });
    renderWithRouter(<FleetScreen />);

    const cells = within(await screen.findByRole('row', { name: /Acme Ltd/ }));
    expect(cells.getByText('Standard')).toBeInTheDocument();
    expect(cells.getByText('Offline')).toBeInTheDocument();
    expect(cells.getByText('acme.raniafrica.co.ke')).toBeInTheDocument();
    // Nothing has reported yet, so nothing is claimed about seats or storage.
    expect(cells.getByText('Not reported')).toBeInTheDocument();
  });

  it('turns a stack live when it reports in, without asking the server again', async () => {
    fetchStub = stubFetch({ 'GET /api/v1/fleet': [row] });
    renderWithRouter(<FleetScreen />);
    await screen.findByRole('row', { name: /Acme Ltd/ });
    const requestsBefore = fetchStub.requests.length;

    deliver('fleet:stack', heartbeat);

    await waitFor(() => {
      expect(
        within(screen.getByRole('row', { name: /Acme Ltd/ })).getByText('Live'),
      ).toBeInTheDocument();
    });
    const cells = within(screen.getByRole('row', { name: /Acme Ltd/ }));
    expect(cells.getByText('4 / 10')).toBeInTheDocument();
    expect(cells.getByText('5.0 MB')).toBeInTheDocument();
    expect(cells.getByText('abc1234')).toBeInTheDocument();
    expect(fetchStub.requests.length).toBe(requestsBefore);
  });

  it('ignores an event about a customer it is not showing', async () => {
    fetchStub = stubFetch({ 'GET /api/v1/fleet': [row] });
    renderWithRouter(<FleetScreen />);
    await screen.findByRole('row', { name: /Acme Ltd/ });

    deliver('fleet:stack', { ...heartbeat, customerId: '99999999-9999-4999-8999-999999999999' });

    expect(
      within(screen.getByRole('row', { name: /Acme Ltd/ })).getByText('Offline'),
    ).toBeInTheDocument();
  });

  it('offers to create a stack for a customer that has none', async () => {
    fetchStub = stubFetch({ 'GET /api/v1/fleet': [{ ...row, stacks: [] }] });
    renderWithRouter(<FleetScreen />);

    const cells = within(await screen.findByRole('row', { name: /Acme Ltd/ }));
    expect(cells.getByRole('button', { name: 'Create stack' })).toBeInTheDocument();
  });

  it('says so plainly when there are no customers at all', async () => {
    fetchStub = stubFetch({ 'GET /api/v1/fleet': [] });
    renderWithRouter(<FleetScreen />);

    expect(await screen.findByText('No customers yet')).toBeInTheDocument();
  });
});
