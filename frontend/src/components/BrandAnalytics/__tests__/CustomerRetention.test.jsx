import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CustomerRetention from '../CustomerRetention.jsx';

vi.mock('../../../services/api.js', () => ({
  getCustomerRetention:       vi.fn(),
  triggerBrandAnalyticsFetch: vi.fn(),
}));

import { getCustomerRetention, triggerBrandAnalyticsFetch } from '../../../services/api.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CustomerRetention — empty state', () => {
  it('renders the Fetch CTA when the report is missing', async () => {
    getCustomerRetention.mockRejectedValue({
      response: { data: { error: 'No completed REPEAT_PURCHASE report yet. Wait for the next scheduled fetch or trigger one via POST /api/brand-analytics/reports/refresh.' } },
    });

    render(<CustomerRetention />);

    await waitFor(() => expect(screen.getByText(/no retention data yet/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /fetch now/i })).toBeInTheDocument();
  });

  it('persists the CTA after a tier-gated fetch failure and flips the label to "Try again"', async () => {
    const user = userEvent.setup();
    getCustomerRetention.mockRejectedValue({
      response: { data: { error: 'No completed REPEAT_PURCHASE report yet.' } },
    });
    triggerBrandAnalyticsFetch.mockRejectedValue({
      response: { data: { error: 'Your subscription tier does not include the "REPEAT_PURCHASE" report. Upgrade to PRO to access it.' } },
    });

    render(<CustomerRetention />);
    await waitFor(() => expect(screen.getByRole('button', { name: /fetch now/i })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /fetch now/i }));

    // After failure: error visible inline, CTA still there with "Try again"
    await waitFor(() => expect(screen.getByText(/upgrade to pro/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(screen.getByText(/no retention data yet/i)).toBeInTheDocument();
  });
});

describe('CustomerRetention — data state', () => {
  it('renders brand repeat rate, S&S spotlight, and per-ASIN table', async () => {
    getCustomerRetention.mockResolvedValue({
      period:  { periodStart: '2026-01-01', periodEnd: '2026-03-31', fetchedAt: '2026-04-01T10:00:00Z' },
      summary: {
        brandRepeatRate:  18.4,
        totalCustomers:   1500,
        repeatCustomers:  276,
        topRepeaters:     [{ asin: 'B0DW46MR5R', title: 'Top Item', repeatRate: 42 }],
      },
      asins: [
        { asin: 'B0DW46MR5R', title: 'Top Item',     totalCustomers: 200, repeatCustomers: 84, repeatRate: 42, daysBetweenOrders: 45, subscribeAndSaveCandidate: true },
        { asin: 'B08N1B3W2G', title: 'Average Item', totalCustomers: 100, repeatCustomers: 12, repeatRate: 12, daysBetweenOrders: 0,  subscribeAndSaveCandidate: false },
      ],
    });

    render(<CustomerRetention />);

    // Hero — fmtPct yields "18.4%" for values >= 10 (1 decimal place)
    expect(await screen.findByText(/^\s*18\.4%\s*$/)).toBeInTheDocument();
    // The "276 of 1,500" sub-line appears as a single rendered <p>; use a
    // function matcher scoped to that element only (textContent on parents
    // would also match, so the default getByText finds multiple).
    expect(
      screen.getAllByText((_, n) =>
        n?.tagName === 'P' && /276 of 1,500 customers came back/i.test(n.textContent ?? '')
      ).length
    ).toBeGreaterThan(0);

    // S&S spotlight
    expect(screen.getByText(/Subscribe & Save candidates/i)).toBeInTheDocument();
    // ASIN appears in both spotlight and table
    expect(screen.getAllByText('B0DW46MR5R').length).toBeGreaterThanOrEqual(1);

    // Table contains both ASINs
    expect(screen.getByText('B08N1B3W2G')).toBeInTheDocument();
    expect(screen.getByText('Average Item')).toBeInTheDocument();
  });

  it('hides the S&S spotlight when there are no candidates', async () => {
    getCustomerRetention.mockResolvedValue({
      // Distinct hero/row values so the percentage text doesn't collide.
      period:  { periodStart: '2026-01-01', periodEnd: '2026-03-31', fetchedAt: '2026-04-01T10:00:00Z' },
      summary: { brandRepeatRate: 7, totalCustomers: 100, repeatCustomers: 7, topRepeaters: [] },
      asins:   [{ asin: 'B0NOREPEAT', title: 'X', totalCustomers: 100, repeatCustomers: 3, repeatRate: 3, daysBetweenOrders: 0, subscribeAndSaveCandidate: false }],
    });

    render(<CustomerRetention />);
    // Hero brand repeat rate (7.00%) — distinct from the 3.00% in the table row.
    expect(await screen.findByText(/^\s*7\.00%\s*$/)).toBeInTheDocument();
    expect(screen.queryByText(/Subscribe & Save candidates/i)).not.toBeInTheDocument();
  });
});
