/**
 * The charts are drawn in SVG, and a test cannot see a picture. What it can check is the promise the
 * kit makes about every chart: that the figures a screen reader is given are the figures that were
 * drawn, that the plot itself is hidden so those numbers are never announced twice, that a chart
 * with nothing to show says so instead of drawing an empty axis, and that the cursor can be moved
 * without a mouse.
 *
 * These are the properties that break silently. A chart that looks wrong is noticed; a chart whose
 * hidden table has drifted from its line is not.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { SeriesPoint } from '@crm/shared';
import { BarChart, ChartFrame, HeatStrip, TrendChart } from '@crm/ui/charts';
import { seriesTable, uptimeCells, uptimeTable, UPTIME_MAX, wholeCount } from './metrics';

/** Three points, because the fleet will have days of history before it has months. */
const seats: SeriesPoint[] = [
  { t: '2026-09-01', v: 3 },
  { t: '2026-09-02', v: 7 },
  { t: '2026-09-03', v: 6 },
];

function renderSeatsChart(points: SeriesPoint[] = seats) {
  return render(
    <ChartFrame
      label="Seats in use"
      value="6"
      table={seriesTable('Seats in use per day', 'Seats', points, wholeCount)}
    >
      <TrendChart
        format={wholeCount}
        inspectLabel="Inspect seats by day"
        series={[{ key: 'seats', label: 'In use', points }]}
      />
    </ChartFrame>,
  );
}

describe('a chart frame', () => {
  it('writes out the same figures the chart was drawn from', () => {
    renderSeatsChart();

    const table = screen.getByRole('table', { name: 'Seats in use per day' });
    const rows = within(table).getAllByRole('row');
    // One row per point, plus the header.
    expect(rows).toHaveLength(seats.length + 1);

    // Every day and every value, in the order they happened.
    const cells = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) => [...row.children].map((cell) => cell.textContent));
    expect(cells).toEqual([
      ['1 Sep 2026', '3'],
      ['2 Sep 2026', '7'],
      ['3 Sep 2026', '6'],
    ]);
  });

  it('hides the plot from assistive technology, so the figures are offered once', () => {
    const { container } = renderSeatsChart();
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('offers no table at all when there is nothing to put in it', () => {
    renderSeatsChart([]);

    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('No samples yet')).toBeInTheDocument();
  });
});

describe('a series of one point', () => {
  it('is drawn as a point, and counted in the singular', () => {
    const { container } = renderSeatsChart([{ t: '2026-09-03', v: 6 }]);

    // A single sample is not a line, so it is not drawn as one.
    expect(container.querySelectorAll('path')).toHaveLength(0);
    expect(container.querySelectorAll('circle')).toHaveLength(1);

    const cursor = screen.getByRole('slider', { name: 'Inspect seats by day' });
    expect(cursor).toHaveAttribute('aria-valuetext', '1 day to 3 Sep');
  });
});

describe('the trend cursor', () => {
  it('walks the series with the arrow keys and says where it is', async () => {
    const user = userEvent.setup();
    renderSeatsChart();

    const cursor = screen.getByRole('slider', { name: 'Inspect seats by day' });
    expect(cursor).toHaveAttribute('aria-valuemax', String(seats.length - 1));

    // Focus lands on the most recent day, which is the one an owner is standing on.
    await user.tab();
    expect(cursor).toHaveFocus();
    expect(cursor).toHaveAttribute('aria-valuenow', '2');
    expect(cursor).toHaveAttribute('aria-valuetext', '3 Sep 2026, In use 6');

    await user.keyboard('{ArrowLeft}');
    expect(cursor).toHaveAttribute('aria-valuenow', '1');
    expect(cursor).toHaveAttribute('aria-valuetext', '2 Sep 2026, In use 7');

    await user.keyboard('{Home}');
    expect(cursor).toHaveAttribute('aria-valuenow', '0');

    // And it stops at the end of the series rather than running off it.
    await user.keyboard('{ArrowLeft}');
    expect(cursor).toHaveAttribute('aria-valuenow', '0');
  });
});

describe('a bar chart', () => {
  it('writes out a row per category', () => {
    const versions = [
      { version: 'abc1234', stacks: 4 },
      { version: 'def5678', stacks: 1 },
    ];
    render(
      <ChartFrame
        label="Version spread"
        table={{
          caption: 'Stacks per version',
          columns: ['Version', 'Stacks'],
          rows: versions.map((entry) => [entry.version, entry.stacks]),
        }}
      >
        <BarChart
          orientation="horizontal"
          categories={versions.map((entry) => entry.version)}
          series={[
            { key: 'stacks', label: 'Stacks', values: versions.map((entry) => entry.stacks) },
          ]}
          format={wholeCount}
        />
      </ChartFrame>,
    );

    const table = screen.getByRole('table', { name: 'Stacks per version' });
    expect(within(table).getByRole('rowheader', { name: 'abc1234' })).toBeInTheDocument();
    expect(within(table).getByRole('rowheader', { name: 'def5678' })).toBeInTheDocument();
    expect(within(table).getAllByRole('row')).toHaveLength(3);
  });

  it('says so plainly when there is nothing to count', () => {
    render(
      <ChartFrame
        label="Version spread"
        table={{ caption: 'Stacks per version', columns: [], rows: [] }}
      >
        <BarChart
          categories={[]}
          series={[]}
          format={wholeCount}
          emptyLabel="No stack has reported a version yet"
        />
      </ChartFrame>,
    );

    expect(screen.getByText('No stack has reported a version yet')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('a heat strip', () => {
  it('keeps a cell and a table row for every day it was given', () => {
    const days = [
      { t: '2026-09-01', connectedMinutes: 1440, readyFailures: 0 },
      { t: '2026-09-02', connectedMinutes: 0, readyFailures: 0 },
      { t: '2026-09-03', connectedMinutes: 1200, readyFailures: 2 },
    ];
    const { container } = render(
      <ChartFrame label="Uptime" table={uptimeTable(days)}>
        <HeatStrip
          days={uptimeCells(days)}
          max={UPTIME_MAX}
          format={(minutes) => `${wholeCount(minutes)} minutes`}
        />
      </ChartFrame>,
    );

    expect(container.querySelectorAll('rect')).toHaveLength(days.length);

    const table = screen.getByRole('table', {
      name: 'Minutes connected and failing checks per day',
    });
    const cells = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) => [...row.children].map((cell) => cell.textContent));
    expect(cells).toEqual([
      ['1 Sep 2026', '1440', '0'],
      ['2 Sep 2026', '0', '0'],
      ['3 Sep 2026', '1200', '2'],
    ]);
  });
});
