/**
 * The fleet is the screen an owner leaves open, so the things worth testing are that it changes on
 * its own and that it asks the server for what it is showing.
 *
 * A stack that reconnects turns live without a request, filtering and paging go to the server
 * rather than being done in the browser, and a selection can only offer what this account may do.
 */
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { ConsoleServerPayload } from '@crm/shared';
import { getSocket } from '@/lib/socket';
import type { FleetRow, Me } from '@/lib/types';
import { renderWithRouter, stubFetch, type FetchStub } from '@/test/render';
import { FleetScreen } from './FleetScreen';

const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';
const STACK_ID = 'stk_abcdefghijklmnopqrst';

const owner: Me = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Liban',
  email: 'liban@example.com',
  role: 'owner',
  twoFactorEnabled: true,
  permissions: [
    'customer:read',
    'customer:write',
    'customer:archive',
    'entitlement:issue',
    'stack:manage',
    'stack:operate',
    'analytics:read',
  ],
};

const support: Me = { ...owner, role: 'support', permissions: ['customer:read', 'stack:operate'] };

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
    suspendedAt: null,
    archivedAt: null,
    archiveReason: null,
    churnReason: null,
    churnedAt: null,
    onboardingStage: 'live',
    onboardingChecklist: {},
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

/** One page of the fleet, in the envelope a paged endpoint actually answers with. */
function pageOf(rows: FleetRow[], total = rows.length) {
  return { data: rows, page: { page: 1, pageSize: 25, total } };
}

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

function render(rows: FleetRow[] = [row], me: Me = owner) {
  fetchStub = stubFetch({
    'GET /api/v1/me': me,
    'GET /api/v1/fleet': pageOf(rows),
    'GET /api/v1/analytics/overview': { alerts: [] },
    'POST /api/v1/customers/bulk/archive': { ok: rows.length, failed: 0, results: [] },
  });
  return renderWithRouter(<FleetScreen />);
}

afterEach(() => {
  fetchStub?.restore();
  fetchStub = null;
  getSocket().removeAllListeners('fleet:stack');
});

describe('the fleet screen', () => {
  it('lists customers with what their stack last reported', async () => {
    render();

    const cells = within(await screen.findByRole('row', { name: /Acme Ltd/ }));
    expect(cells.getByText('Standard')).toBeInTheDocument();
    expect(cells.getByText('Offline')).toBeInTheDocument();
    expect(cells.getByText('acme.raniafrica.co.ke')).toBeInTheDocument();
    // Nothing has reported yet, so nothing is claimed about seats or storage.
    expect(cells.getByText('Not reported')).toBeInTheDocument();
  });

  it('asks the server for one page of the active customers', async () => {
    render();
    await screen.findByRole('row', { name: /Acme Ltd/ });

    const asked = fetchStub?.requests.find((r) => r.path === '/api/v1/fleet');
    expect(asked).toBeDefined();
  });

  it('turns a stack live when it reports in, without asking the server again', async () => {
    render();
    await screen.findByRole('row', { name: /Acme Ltd/ });
    const requestsBefore = fetchStub?.requests.length ?? 0;

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
    expect(fetchStub?.requests.length).toBe(requestsBefore);
  });

  it('ignores an event about a customer it is not showing', async () => {
    render();
    await screen.findByRole('row', { name: /Acme Ltd/ });

    deliver('fleet:stack', { ...heartbeat, customerId: '99999999-9999-4999-8999-999999999999' });

    expect(
      within(screen.getByRole('row', { name: /Acme Ltd/ })).getByText('Offline'),
    ).toBeInTheDocument();
  });

  it('offers to create a stack for a customer that has none', async () => {
    render([{ ...row, stacks: [] }]);

    const cells = within(await screen.findByRole('row', { name: /Acme Ltd/ }));
    expect(cells.getByRole('button', { name: 'Create stack' })).toBeInTheDocument();
  });

  it('says so plainly when there are no customers at all', async () => {
    render([]);

    expect(await screen.findByText('No customers yet')).toBeInTheDocument();
  });

  it('spells out what archiving a selection does before it does it', async () => {
    const user = userEvent.setup();
    render();
    await screen.findByRole('row', { name: /Acme Ltd/ });

    await user.click(await screen.findByRole('checkbox', { name: 'Select Acme Ltd' }));
    await user.click(await screen.findByRole('button', { name: 'Archive' }));

    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText(/Nothing of theirs is deleted/)).toBeVisible();
    expect(dialog.getByText(/one failing does not stop the rest/)).toBeVisible();
    // The dialog is a question: nothing has been sent yet.
    expect(fetchStub?.requests.some((r) => r.method === 'POST')).toBe(false);
  });

  it('offers a support account nothing it may not do', async () => {
    const user = userEvent.setup();
    render([row], support);
    await screen.findByRole('row', { name: /Acme Ltd/ });

    await user.click(await screen.findByRole('checkbox', { name: 'Select Acme Ltd' }));

    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suspend' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New customer' })).not.toBeInTheDocument();
  });
});
