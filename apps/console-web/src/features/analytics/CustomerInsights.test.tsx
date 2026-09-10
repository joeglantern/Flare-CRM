/**
 * The insights tab exists to answer two questions before a renewal: will they run out of something,
 * and has their stack been reliable. Both answers have a way of being overstated, which is what this
 * tests: a projection is only drawn when the server sent one, and a day with no contact is not shown
 * as a day at zero usage.
 */
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { CustomerAnalyticsDto } from '@crm/shared';
import { renderWithRouter, stubFetch, type FetchStub } from '@/test/render';
import { CustomerInsights } from './CustomerInsights';

const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';
const PATH = `/api/v1/analytics/customers/${CUSTOMER_ID}`;
const GB = 1024 ** 3;

const base: CustomerAnalyticsDto = {
  customerId: CUSTOMER_ID,
  rangeDays: 3,
  hasData: true,
  seats: {
    series: [
      { t: '2026-09-01', v: 8 },
      { t: '2026-09-02', v: 9 },
      { t: '2026-09-03', v: 9 },
    ],
    cap: 10,
    latest: 9,
  },
  storage: {
    series: [
      { t: '2026-09-01', v: 4 * GB },
      { t: '2026-09-02', v: 5 * GB },
      { t: '2026-09-03', v: 6 * GB },
    ],
    capBytes: 20 * GB,
    latestBytes: 6 * GB,
    projection: null,
  },
  uptime: {
    percent: 88.5,
    days: [
      { t: '2026-09-01', connectedMinutes: 1440, readyFailures: 0 },
      { t: '2026-09-02', connectedMinutes: 0, readyFailures: 0 },
      { t: '2026-09-03', connectedMinutes: 1380, readyFailures: 2 },
    ],
  },
  backups: {
    lastAt: '2026-09-03T02:00:00.000Z',
    ageHours: 9,
    days: [
      { t: '2026-09-01', seen: true },
      { t: '2026-09-02', seen: false },
      { t: '2026-09-03', seen: true },
    ],
  },
  versions: [
    { from: '2026-09-01', version: 'abc1234' },
    { from: '2026-09-03', version: 'def5678' },
  ],
  events: [
    {
      at: '2026-09-03T09:00:00.000Z',
      kind: 'entitlement',
      label: 'Entitlements issued',
      detail: 'Seats raised to 10',
    },
  ],
};

let fetchStub: FetchStub | null = null;

afterEach(() => {
  fetchStub?.restore();
  fetchStub = null;
});

describe('a customer insights tab', () => {
  it('reads well on three days of history, and draws no projection it was not given', async () => {
    fetchStub = stubFetch({ [`GET ${PATH}`]: base });
    renderWithRouter(<CustomerInsights customerId={CUSTOMER_ID} />);

    expect(await screen.findByText('Seats in use')).toBeInTheDocument();
    expect(screen.getByText(/9 of 10 allowed/)).toBeInTheDocument();

    // No projection in the payload, so the screen says what it knows and nothing about a date.
    expect(screen.getByText(/not growing fast enough to project a date/)).toBeInTheDocument();
    expect(screen.queryByText(/it is full on/)).toBeNull();

    // Each uptime day keeps its own figures, including the day with no contact at all.
    const uptimeRows = within(
      screen.getByRole('table', { name: 'Minutes connected and failing checks per day' }),
    )
      .getAllByRole('row')
      .slice(1)
      .map((row) => [...row.children].map((cell) => cell.textContent));
    expect(uptimeRows).toEqual([
      ['1 Sep 2026', '1440', '0'],
      ['2 Sep 2026', '0', '0'],
      ['3 Sep 2026', '1380', '2'],
    ]);

    // Backups: two of the three days, and fresh enough not to be an alert.
    expect(screen.getByText('Fresh')).toBeInTheDocument();
    expect(screen.getByText(/2 days of the last 3 had a backup/)).toBeInTheDocument();

    // Versions, newest first, and what was sent to the stack.
    expect(screen.getByText('def5678')).toBeInTheDocument();
    expect(screen.getByText('Entitlements issued')).toBeInTheDocument();
  });

  it('projects a full date only when the server worked one out', async () => {
    fetchStub = stubFetch({
      [`GET ${PATH}`]: {
        ...base,
        storage: {
          ...base.storage,
          projection: { fullOn: '2026-11-01', perDayBytes: 1024 ** 3 },
        },
      },
    });
    renderWithRouter(<CustomerInsights customerId={CUSTOMER_ID} />);

    expect(await screen.findByText(/it is full on 1 Nov 2026/)).toBeInTheDocument();
  });

  it('says the stack has not reported rather than drawing a month of nothing', async () => {
    fetchStub = stubFetch({ [`GET ${PATH}`]: { ...base, hasData: false } });
    renderWithRouter(<CustomerInsights customerId={CUSTOMER_ID} />);

    expect(await screen.findByText('This stack has not reported in yet')).toBeInTheDocument();
    expect(screen.queryByText('Seats in use')).toBeNull();
  });

  it('marks a backup that has not run for days as stale', async () => {
    fetchStub = stubFetch({
      [`GET ${PATH}`]: {
        ...base,
        backups: { ...base.backups, ageHours: 61 },
      },
    });
    renderWithRouter(<CustomerInsights customerId={CUSTOMER_ID} />);

    expect(await screen.findByText('Stale')).toBeInTheDocument();
    expect(screen.queryByText('Fresh')).toBeNull();
  });
});
