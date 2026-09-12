/**
 * What is worth testing about the inbox is that it is an inbox rather than a filter over one list:
 * each tab is a question put to the server, and an action on a row is a decision recorded there.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { Alert, AlertMute, AlertSummary, Me } from '@/lib/types';
import { renderWithRouter, stubFetch, type FetchStub } from '@/test/render';
import { AlertsScreen } from './AlertsScreen';

const ALERT_ID = '55555555-5555-4555-8555-555555555555';
const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';

const owner: Me = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Liban',
  email: 'liban@example.com',
  role: 'owner',
  twoFactorEnabled: true,
  permissions: ['alert:read', 'alert:ack', 'alert:manage', 'customer:read'],
};

/** A support account may act on an alert and may not mute one. */
const support: Me = {
  ...owner,
  role: 'support',
  permissions: ['alert:read', 'alert:ack', 'customer:read'],
};

const alert: Alert = {
  id: ALERT_ID,
  kind: 'stack_never_connected',
  level: 'danger',
  state: 'open',
  customerId: CUSTOMER_ID,
  customerName: 'Kilimani Auto Parts',
  stackId: 'stk_abcdefghijklmnopqrst',
  summary: 'Credentials were issued 2 days ago and this stack has never reported in.',
  openedAt: '2026-09-12T08:00:00.000Z',
  resolvedAt: null,
  acknowledgedAt: null,
  acknowledgedByName: null,
  snoozedUntil: null,
  closedAt: null,
  closeReason: null,
  context: {},
};

const summary: AlertSummary = {
  open: 1,
  acked: 0,
  snoozed: 0,
  byLevel: { danger: 1, warning: 0, info: 0 },
};

let fetchStub: FetchStub | null = null;

function render(rows: Alert[] = [alert], me: Me = owner, mutes: AlertMute[] = []) {
  fetchStub = stubFetch({
    'GET /api/v1/me': me,
    'GET /api/v1/alerts': { data: rows, page: { page: 1, pageSize: 25, total: rows.length } },
    'GET /api/v1/alerts/summary': summary,
    'GET /api/v1/alerts/mutes': mutes,
    [`POST /api/v1/alerts/${ALERT_ID}/ack`]: { ...alert, state: 'acked' },
    'POST /api/v1/alerts/mutes': { id: 'm1' },
  });
  return renderWithRouter(<AlertsScreen />);
}

afterEach(() => {
  fetchStub?.restore();
  fetchStub = null;
});

describe('the alert inbox', () => {
  it('says what the matter is, whose it is, and how long it has been true', async () => {
    render();

    const row = within(await screen.findByRole('row', { name: /Never connected/ }));
    expect(row.getByText('Kilimani Auto Parts')).toBeInTheDocument();
    expect(row.getByText(/never reported in/)).toBeInTheDocument();
    expect(row.getByText('Open')).toBeInTheDocument();
  });

  it('acknowledges one, which is a decision recorded on the server', async () => {
    const user = userEvent.setup();
    render();
    await screen.findByRole('row', { name: /Never connected/ });

    await user.click(screen.getByRole('button', { name: 'Acknowledge' }));

    await waitFor(() => {
      expect(
        fetchStub?.requests.some(
          (r) => r.method === 'POST' && r.path === `/api/v1/alerts/${ALERT_ID}/ack`,
        ),
      ).toBe(true);
    });
  });

  it('asks the server for each tab rather than filtering what it already has', async () => {
    const user = userEvent.setup();
    render();
    await screen.findByRole('row', { name: /Never connected/ });
    const before = fetchStub?.requests.filter((r) => r.path === '/api/v1/alerts').length ?? 0;

    await user.click(screen.getByRole('tab', { name: /Finished/ }));

    await waitFor(() => {
      const asked = fetchStub?.requests.filter((r) => r.path === '/api/v1/alerts') ?? [];
      expect(asked.length).toBeGreaterThan(before);
    });
  });

  it('makes closing one explain itself, because it contradicts the check', async () => {
    const user = userEvent.setup();
    render();
    await screen.findByRole('row', { name: /Never connected/ });

    await user.click(screen.getByRole('button', { name: 'Close' }));

    const close = screen.getByRole('button', { name: 'Close alert' });
    expect(close).toBeDisabled();
    await user.type(screen.getByLabelText('Why'), 'Server is being rebuilt.');
    expect(close).toBeEnabled();
  });

  it('shows what is muted, so an empty inbox can be trusted', async () => {
    render([], owner, [
      {
        id: 'm1',
        kind: 'backup_stale',
        customerId: CUSTOMER_ID,
        customerName: 'Kilimani Auto Parts',
        reason: 'They back up to their own tape.',
        createdAt: '2026-09-01T08:00:00.000Z',
        expiresAt: null,
      },
    ]);

    expect(await screen.findByText('Backup stale at Kilimani Auto Parts')).toBeInTheDocument();
    expect(screen.getByText('They back up to their own tape.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lift' })).toBeInTheDocument();
  });

  it('offers a support account the actions it has and not the ones it has not', async () => {
    render([alert], support);
    await screen.findByRole('row', { name: /Never connected/ });

    expect(screen.getByRole('button', { name: 'Acknowledge' })).toBeInTheDocument();
    // Muting is an owner's standing decision about what the console stops saying.
    expect(screen.queryByRole('button', { name: 'Mute' })).not.toBeInTheDocument();
    expect(screen.queryByText('Muted')).not.toBeInTheDocument();
  });
});
