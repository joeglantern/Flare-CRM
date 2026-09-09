import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { FeatureGate } from './FeatureGate';

describe('FeatureGate', () => {
  it('renders the screen when the plan includes the feature', () => {
    renderWithProviders(
      <FeatureGate feature="telephony">
        <p>Call history</p>
      </FeatureGate>,
    );
    expect(screen.getByText('Call history')).toBeInTheDocument();
  });

  it('names the feature and who to contact when the plan does not include it', () => {
    renderWithProviders(
      <FeatureGate feature="telephony" what="Call history">
        <p>Call history</p>
      </FeatureGate>,
      { entitlements: { features: { telephony: false } } },
    );
    expect(screen.queryByText('Call history')).not.toBeInTheDocument();
    expect(screen.getByText('Call history is not available')).toBeInTheDocument();
    expect(screen.getByText('support@example.com')).toHaveAttribute(
      'href',
      'mailto:support@example.com',
    );
    // the only way out is the plan page, and only for someone who can open it
    expect(screen.getByRole('link', { name: 'See your plan' })).toHaveAttribute(
      'href',
      '/settings?section=plan',
    );
  });

  it('blames the role, not the plan, when the person could never use the screen anyway', () => {
    renderWithProviders(
      <FeatureGate feature="telephony" permission="pbx:view_status" what="Live calls">
        <p>Live calls</p>
      </FeatureGate>,
      {
        me: { permissions: [] },
        entitlements: { features: { telephony: false } },
      },
    );
    expect(screen.getByText('You do not have access to Live calls')).toBeInTheDocument();
    expect(screen.getByText('pbx:view_status')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'See your plan' })).not.toBeInTheDocument();
  });

  it('offers no plan link to someone who cannot open settings', () => {
    renderWithProviders(
      <FeatureGate feature="deals">
        <p>Deals</p>
      </FeatureGate>,
      { me: { permissions: [] }, entitlements: { features: { deals: false } } },
    );
    expect(screen.getByText('Deals and pipelines is not part of your plan')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'See your plan' })).not.toBeInTheDocument();
  });
});
