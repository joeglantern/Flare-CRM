import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { PlanSection } from './PlanSection';

describe('PlanSection', () => {
  it('shows the plan, what is included and what is not', () => {
    renderWithProviders(<PlanSection />, {
      entitlements: { features: { telephony: false, recordings: false, softphone: false } },
    });
    expect(screen.getByText('Test plan')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Test Customer Ltd')).toBeInTheDocument();
    // one row per feature, each saying which way it is
    expect(screen.getAllByText('Not included')).toHaveLength(3);
    expect(screen.getAllByText('Included').length).toBeGreaterThan(0);
  });

  it('reads out limits with usage, and says so plainly when there is no limit', () => {
    renderWithProviders(<PlanSection />, {
      entitlements: {
        limits: { seats: 5, storage_gb: 10, recording_retention_days: 90 },
        usage: {
          seats: { used: 3, max: 5 },
          storage: {
            usedBytes: 5 * 1024 ** 3,
            maxBytes: 10 * 1024 ** 3,
            breakdown: { attachments: 1, recordings: 2, backups: 3 },
            refreshedAt: null,
          },
          channels: { used: 2, max: null },
          pipelines: { used: 1, max: null },
          recordingRetentionDays: { configured: 365, max: 90, effective: 90 },
        },
      },
    });
    expect(screen.getByText('3 of 5')).toBeInTheDocument();
    expect(screen.getByText('5.0 GB of 10 GB')).toBeInTheDocument();
    expect(screen.getByText('90 days, capped at 90')).toBeInTheDocument();
    expect(screen.getByText('2 · No limit')).toBeInTheDocument();
    const seats = screen.getByRole('progressbar', { name: 'Active users' });
    expect(seats).toHaveAttribute('aria-valuenow', '3');
    expect(seats).toHaveAttribute('aria-valuemax', '5');
  });

  it('says the workspace is read only once the plan has ended', () => {
    renderWithProviders(<PlanSection />, {
      entitlements: { expired: true, expiresInDays: -3, expiresAt: '2026-09-07T00:00:00.000Z' },
    });
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.getByText(/read only until the plan is renewed/)).toBeInTheDocument();
  });

  it('warns before the end rather than after', () => {
    renderWithProviders(<PlanSection />, {
      entitlements: { expiresInDays: 9, expiresAt: '2026-09-19T00:00:00.000Z' },
    });
    expect(screen.getByText('Ends in 9 days')).toBeInTheDocument();
  });

  it('offers a file reload only for a stack that loads its plan from a file', () => {
    renderWithProviders(<PlanSection />);
    expect(screen.queryByRole('button', { name: 'Reload from file' })).not.toBeInTheDocument();
    renderWithProviders(<PlanSection />, { entitlements: { source: 'file' } });
    expect(screen.getByRole('button', { name: 'Reload from file' })).toBeInTheDocument();
  });
});
