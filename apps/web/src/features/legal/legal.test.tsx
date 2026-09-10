/**
 * The public documents are quoted to Meta and to a regulator, so what matters in a test is not
 * that they render but that the specific things those readers look for are actually on the page:
 * a contact address, the deletion route, and the named supervisory authority.
 */
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { DataDeletion } from './DataDeletion';
import { PrivacyPolicy } from './PrivacyPolicy';
import { Terms } from './Terms';
import { PROVIDER } from './provider';

describe('the public legal documents', () => {
  it('give a privacy policy that says who to write to and where to complain', () => {
    render(<PrivacyPolicy />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Privacy policy');
    expect(screen.getAllByRole('link', { name: PROVIDER.email }).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: PROVIDER.regulator.name })).toHaveAttribute(
      'href',
      PROVIDER.regulator.url,
    );
    // Meta review reads this section by name; losing it would fail the app submission.
    expect(screen.getByRole('heading', { name: 'WhatsApp messages' })).toBeInTheDocument();
  });

  it('give deletion instructions that name a route and a deadline', () => {
    render(<DataDeletion />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Deleting your data');
    expect(screen.getByRole('heading', { name: 'Deleting a WhatsApp conversation' })).toBeVisible();
    expect(screen.getByText(/thirty days/)).toBeVisible();
  });

  it('give terms that state what support can reach', () => {
    render(<Terms />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Terms of service');
    const support = screen.getByRole('heading', {
      name: 'Support, and what we can reach',
    }).parentElement;
    expect(support).not.toBeNull();
    // The promise made in the console's own audit trail, repeated where a customer can hold us to
    // it: three actions, and no reading of their business data.
    expect(within(support!).getByText(/cannot read their/)).toBeVisible();
  });

  it('carry the same footer on every document', () => {
    for (const Doc of [PrivacyPolicy, Terms, DataDeletion]) {
      const { unmount } = render(<Doc />);
      expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
      expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
      expect(screen.getByRole('link', { name: 'Deleting your data' })).toHaveAttribute(
        'href',
        '/data-deletion',
      );
      unmount();
    }
  });
});
