import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FlareMark, FlareWordmark } from './Logo';

describe('brand components', () => {
  it('renders the mark as an accessible image in the brand colour', () => {
    render(<FlareMark size={32} />);
    const svg = screen.getByRole('img', { name: 'Flare CRM' });
    expect(svg).toHaveAttribute('width', '32');
    expect(svg.querySelector('path')).toHaveAttribute('fill', '#FF6A3D');
  });

  it('renders the wordmark text', () => {
    render(<FlareWordmark />);
    expect(screen.getByLabelText('Flare CRM')).toHaveTextContent('Flare');
    expect(screen.getByLabelText('Flare CRM')).toHaveTextContent('CRM');
  });
});
