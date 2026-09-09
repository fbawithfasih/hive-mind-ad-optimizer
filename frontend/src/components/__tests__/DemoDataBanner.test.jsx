import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import DemoDataBanner from '../DemoDataBanner.jsx';

describe('DemoDataBanner', () => {
  it('renders nothing unless the selected profile is the sample', () => {
    const { container } = render(<DemoDataBanner visible={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('names the fiction and sends the seller to the Seller Central consent first', () => {
    // The Ads consent cannot be saved without an SP credential, so the CTA
    // must start at /start, not /ads-start.
    render(<DemoDataBanner visible />);
    expect(screen.getByText(/sample data/i)).toBeInTheDocument();
    expect(screen.getByText(/fictional/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Connect Amazon/ })).toHaveAttribute('href', '/api/sp-oauth/start');
  });
});
