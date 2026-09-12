/**
 * The stacks screen exists to answer "which machine is unhappy", so what is worth testing is that
 * it asks the server that question rather than filtering in the browser, and that it changes on its
 * own when a stack reports in.
 */
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { ConsoleServerPayload } from '@crm/shared';
import { getSocket } from '@/lib/socket';
import type { Me, StackRow } from '@/lib/types';
import { renderWithRouter, stubFetch, type FetchStub } from '@/test/render';
import { StacksScreen } from './StacksScreen';

const STACK_ID = 'stk_abcdefghijklmnopqrst';
const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';

const owner: Me = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Liban',
  email: 'liban@example.com',
  role: 'owner',
  twoFactorEnabled: true,
  permissions: ['stack:read', 'stack:operate', 'stack:manage', 'customer:read'],
};

const row: StackRow = {
  id: STACK_ID,
  label: 'nairobi-box-1',
  notes: '',
  customer: { id: CUSTOMER_ID, name: 'Kilimani Auto Parts', slug: 'kilimani' },
  connected: false,
  lastSeenAt: null,
  startedAt: null,
  version: null,
  domain: null,
  lastBackupAt: null,
  revokedAt: null,
  currentIssueId: null,
  usage: null,
  health: null,
};

const heartbeat: ConsoleServerPayload<'fleet:stack'> = {
  at: '2026-09-12T10:00:00.000Z',
  customerId: CUSTOMER_ID,
  stackId: STACK_ID,
  connected: true,
  lastSeenAt: '2026-09-12T10:00:00.000Z',
  version: 'abc1234',
  usage: {
    seatsActive: 6,
    storageBytes: 3 * 1024 * 1024,
    attachmentsBytes: 2 * 1024 * 1024,
    recordingsBytes: 1024 * 1024,
    backupsBytes: 0,
  },
  readyOk: true,
  lastBackupAt: '2026-09-12T02:00:00.000Z',
};

let fetchStub: FetchStub | null = null;

function deliver(payload: ConsoleServerPayload<'fleet:stack'>): void {
  const listeners = getSocket().listeners('fleet:stack');
  expect(listeners.length).toBeGreaterThan(0);
  act(() => {
    for (const listener of listeners) listener(payload);
  });
}

function render(rows: StackRow[] = [row], me: Me = owner) {
  fetchStub = stubFetch({
    'GET /api/v1/me': me,
    'GET /api/v1/stacks': { data: rows, page: { page: 1, pageSize: 50, total: rows.length } },
  });
  return renderWithRouter(<StacksScreen />);
}

afterEach(() => {
  fetchStub?.restore();
  fetchStub = null;
  getSocket().removeAllListeners('fleet:stack');
});

describe('the stacks screen', () => {
  it('lists each server with whose it is', async () => {
    render();

    const cells = within(await screen.findByRole('row', { name: /nairobi-box-1/ }));
    expect(cells.getByText('Kilimani Auto Parts')).toBeInTheDocument();
    expect(cells.getByText(STACK_ID)).toBeInTheDocument();
    expect(cells.getByText('Offline')).toBeInTheDocument();
  });

  it('turns one live when it reports in, without asking the server again', async () => {
    render();
    await screen.findByRole('row', { name: /nairobi-box-1/ });
    const before = fetchStub?.requests.length ?? 0;

    deliver(heartbeat);

    await waitFor(() => {
      expect(
        within(screen.getByRole('row', { name: /nairobi-box-1/ })).getByText('Live'),
      ).toBeInTheDocument();
    });
    expect(
      within(screen.getByRole('row', { name: /nairobi-box-1/ })).getByText('abc1234'),
    ).toBeInTheDocument();
    expect(fetchStub?.requests.length).toBe(before);
  });

  it('asks the server for the quiet ones rather than filtering here', async () => {
    const user = userEvent.setup();
    render();
    await screen.findByRole('row', { name: /nairobi-box-1/ });

    await user.click(screen.getByRole('tab', { name: 'Quiet' }));

    await waitFor(() => {
      const asked = fetchStub?.requests.filter((r) => r.path === '/api/v1/stacks') ?? [];
      expect(asked.length).toBeGreaterThan(1);
    });
    expect(screen.getByText(/including stacks that have never reported in/)).toBeVisible();
  });

  it('marks a revoked stack as refused rather than offline', async () => {
    render([{ ...row, revokedAt: '2026-09-11T00:00:00.000Z' }]);

    const cells = within(await screen.findByRole('row', { name: /nairobi-box-1/ }));
    expect(cells.getByText('Refused')).toBeInTheDocument();
    expect(cells.getByText('Revoked')).toBeInTheDocument();
  });
});
