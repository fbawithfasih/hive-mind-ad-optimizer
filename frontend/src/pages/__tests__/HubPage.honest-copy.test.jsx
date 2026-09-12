/**
 * The Hub describes what ships.
 *
 * Amazon's app review rejected a description that promised more than the
 * product did, and the Hub was the worst offender inside the product itself:
 * Sponsored Brands and Display (only Sponsored Products is implemented), A+
 * content (not generated), suppression alerts (not monitored), bid automation
 * (rules move budgets and state, never bids). This pins the retired promises
 * so a future card cannot quietly bring one back.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../services/api.js', () => ({
  logoutApi: vi.fn(), switchOrgApi: vi.fn(), syncProfilesApi: vi.fn(),
}));
vi.mock('../../observability.js', () => ({ reportError: vi.fn() }));

import HubPage from '../HubPage.jsx';
import { ThemeProvider } from '../../hooks/useTheme.jsx';

const user = {
  email: 'demo@example.com',
  currentOrg: { id: 'o1', name: 'Hive Mind Nestor', tier: 'GROWTH' },
  organizations: [{ id: 'o1', name: 'Hive Mind Nestor', tier: 'GROWTH' }],
};

beforeEach(() => {
  window.matchMedia = vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  render(
    <MemoryRouter>
      <ThemeProvider><HubPage user={user} onLogout={vi.fn()} /></ThemeProvider>
    </MemoryRouter>
  );
});

describe('retired promises stay retired', () => {
  it.each([
    ['Sponsored Brands / Display', /Brands & Display/],
    ['A+ content',                 /A\+ content/],
    ['suppression alerts',         /suppression alerts/],
    ['every ASIN',                 /all your ASINs/],
    ['bid automation',             /auto-adjust bids|Optimise bids/],
    ['round-the-clock',            /24\/7/],
  ])('does not claim %s', (_label, pattern) => {
    expect(screen.queryByText(pattern)).toBeNull();
  });
});

it('still says what campaigns and rules actually do', () => {
  expect(screen.getByText(/your Sponsored Products campaigns/)).toBeInTheDocument();
  expect(screen.getByText(/never touching bids/)).toBeInTheDocument();
});
