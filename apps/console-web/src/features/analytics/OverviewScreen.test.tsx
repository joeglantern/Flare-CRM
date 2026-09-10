/**
 * The overview is the first screen an owner sees, including on the day the console is installed and
 * nothing has reported in yet. That day is what this tests: a fleet with no samples must say so, and
 * must not draw a row of charts flat on their baselines, which would read as a fleet at zero rather
 * than a fleet that has not been measured.
 *
 * Then the other direction: given samples, the figures on the screen are the ones in the payload.
 */
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ConsoleOverviewDto, RevenueAnalyticsDto, SeriesPoint } from '@crm/shared';
import { getSocket } from '@/lib/socket';
import { renderWithRouter, stubFetch, type FetchStub } from '@/test/render';
import { OverviewScreen } from './OverviewScreen';

const OVERVIEW = '/api/v1/analytics/overview';
const REVENUE = '/api/v1/analytics/revenue';

/** Dense, the way the server sends it: every day present, zeros included. */
function series(values: number[]): SeriesPoint[] {
  return values.map((v, index) => ({ t: `2026-09-0${index + 1}`, v }));
}

const flat = series([0, 0, 0]);

const empty: ConsoleOverviewDto = {
  generatedAt: '2026-09-10T10:00:00.000Z',
  rangeDays: 30,
  hasData: false,
  now: {
    customers: 2,
    customersActive: 2,
    customersLive: 0,
    stacks: 1,
    seats: { used: 0, sold: 0, unlimited: 0 },
    storage: { usedBytes: 0, soldBytes: 0, unlimited: 0 },
    currency: 'KES',
    mrrMinor: 0,
    arpuMinor: 0,
    openAlerts: 0,
  },
  series: {
    customers: flat,
    live: flat,
    seatsUsed: flat,
    seatsSold: flat,
    storageBytes: flat,
    mrrMinor: flat,
  },
  planMix: [],
  versions: [],
  expiring: [],
  delivery: { medianAckSeconds: null, pending: 0, rejected: 0 },
  alerts: [],
};

const reporting: ConsoleOverviewDto = {
  ...empty,
  hasData: true,
  now: {
    customers: 3,
    customersActive: 3,
    customersLive: 2,
    stacks: 3,
    seats: { used: 14, sold: 30, unlimited: 0 },
    storage: { usedBytes: 6 * 1024 ** 3, soldBytes: 20 * 1024 ** 3, unlimited: 0 },
    currency: 'KES',
    mrrMinor: 450_000,
    arpuMinor: 150_000,
    openAlerts: 1,
  },
  series: {
    customers: series([2, 3, 3]),
    live: series([1, 1, 2]),
    seatsUsed: series([9, 12, 14]),
    seatsSold: series([30, 30, 30]),
    storageBytes: series([4 * 1024 ** 3, 5 * 1024 ** 3, 6 * 1024 ** 3]),
    mrrMinor: series([300_000, 450_000, 450_000]),
  },
  planMix: [
    { planId: 'plan-1', name: 'Standard', customers: 2, mrrMinor: 300_000 },
    { planId: 'plan-2', name: 'Growth', customers: 1, mrrMinor: 150_000 },
  ],
  versions: [
    { version: 'abc1234', stacks: 2 },
    { version: 'def5678', stacks: 1 },
  ],
  expiring: [
    {
      customerId: '11111111-1111-4111-8111-111111111111',
      name: 'Acme Ltd',
      expiresAt: '2026-09-20T00:00:00.000Z',
      days: 10,
      mrrMinor: 150_000,
    },
  ],
  delivery: { medianAckSeconds: 3, pending: 1, rejected: 0 },
  alerts: [
    {
      id: 'alert-1',
      kind: 'backup_stale',
      level: 'warning',
      customerId: '11111111-1111-4111-8111-111111111111',
      customerName: 'Acme Ltd',
      stackId: 'stk_abcdefghijklmnopqrst',
      openedAt: '2026-09-09T10:00:00.000Z',
      resolvedAt: null,
      context: { hours: 61 },
    },
  ],
};

const revenue: RevenueAnalyticsDto = {
  currency: 'KES',
  mrrMinor: 450_000,
  arpuMinor: 150_000,
  payingCustomers: 3,
  months: [
    { t: '2026-07-01', v: 300_000 },
    { t: '2026-08-01', v: 300_000 },
    { t: '2026-09-01', v: 450_000 },
  ],
  byPlan: [{ planId: 'plan-1', name: 'Standard', customers: 2, mrrMinor: 300_000 }],
  atRisk: { minor: 150_000, customers: 1, withinDays: 14 },
};

let fetchStub: FetchStub | null = null;

afterEach(() => {
  fetchStub?.restore();
  fetchStub = null;
  getSocket().removeAllListeners('alert:changed');
});

describe('the overview screen', () => {
  it('says no stack has reported rather than drawing charts of nothing', async () => {
    fetchStub = stubFetch({ [`GET ${OVERVIEW}`]: empty });
    renderWithRouter(<OverviewScreen />);

    expect(await screen.findByText('No stack has reported in yet')).toBeInTheDocument();
    // It still says what it does know, so the screen is not simply blank.
    expect(screen.getByText(/2 customers and 1 stack set up so far/)).toBeInTheDocument();

    // And none of the charts are on the page claiming a flat line at zero.
    expect(screen.queryByText('Seats in use')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    // Revenue is not even asked for until there is something to draw it against.
    expect(fetchStub.requests.some((request) => request.path === REVENUE)).toBe(false);
  });

  it('draws the fleet once stacks are reporting, from the figures it was given', async () => {
    fetchStub = stubFetch({ [`GET ${OVERVIEW}`]: reporting, [`GET ${REVENUE}`]: revenue });
    renderWithRouter(<OverviewScreen />);

    expect(await screen.findByText('Seats in use')).toBeInTheDocument();
    expect(screen.queryByText('No stack has reported in yet')).toBeNull();

    // The seat chart's own table carries the two series it drew, day by day.
    const seatTable = await screen.findByRole('table', {
      name: 'Seats in use and seats sold per day',
    });
    const seatRows = within(seatTable)
      .getAllByRole('row')
      .slice(1)
      .map((row) => [...row.children].map((cell) => cell.textContent));
    expect(seatRows).toEqual([
      ['1 Sep 2026', '9', '30'],
      ['2 Sep 2026', '12', '30'],
      ['3 Sep 2026', '14', '30'],
    ]);
    expect(screen.getByText('14 of 30 sold, 47% taken.')).toBeInTheDocument();

    // The plan mix: two of three customers on Standard, which the ring says as a share and its
    // table says as a count.
    const planTable = screen.getByRole('table', { name: 'Customers and revenue by plan' });
    expect(within(planTable).getByRole('rowheader', { name: 'Standard' })).toBeInTheDocument();
    expect(screen.getByText('67%')).toBeInTheDocument();

    // The version spread and what is about to expire.
    const versionTable = screen.getByRole('table', { name: 'Stacks per version' });
    expect(within(versionTable).getByRole('rowheader', { name: 'abc1234' })).toBeInTheDocument();
    expect(screen.getByText('in 10 days')).toBeInTheDocument();

    // And the one open alert is named in the words the fleet and its emails use.
    expect(screen.getByText('Backup stale')).toBeInTheDocument();
    expect(
      screen.getByText('No backup has run on this stack for more than two days.'),
    ).toBeInTheDocument();
  });

  it('keeps the revenue section to itself when revenue alone fails', async () => {
    // Only the overview is stubbed, so the revenue request answers 500 the way the stub does.
    fetchStub = stubFetch({ [`GET ${OVERVIEW}`]: reporting });
    renderWithRouter(<OverviewScreen />);

    // The rest of the screen is there.
    expect(await screen.findByText('Seats in use')).toBeInTheDocument();
    // And the part that failed says it failed rather than showing an empty chart.
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('That did not load')).toBeInTheDocument();
  });
});
