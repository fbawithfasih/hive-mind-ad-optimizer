import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReportsList from '../ReportsList.jsx';

vi.mock('../../../services/api.js', () => ({
  listBrandAnalyticsReports:   vi.fn(),
  triggerBrandAnalyticsFetch:  vi.fn(),
  getBrandAnalyticsReport:     vi.fn(),
}));

import {
  listBrandAnalyticsReports,
  triggerBrandAnalyticsFetch,
} from '../../../services/api.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ReportsList — rendering', () => {
  it('shows a row for every known report type, even when no reports exist yet', async () => {
    listBrandAnalyticsReports.mockResolvedValue({ reports: [] });

    render(<ReportsList />);

    await waitFor(() => expect(screen.getByText(/no reports yet/i)).toBeInTheDocument());
    // Type rows present even with empty data
    expect(screen.getByText('Top Search Terms')).toBeInTheDocument();
    expect(screen.getByText('Catalog Performance')).toBeInTheDocument();
    expect(screen.getByText('Repeat Purchase')).toBeInTheDocument();
    expect(screen.getByText('Market Basket')).toBeInTheDocument();
    expect(screen.getByText('Search Query (Brand)')).toBeInTheDocument();
  });

  it('renders the latest report per type with status pill', async () => {
    listBrandAnalyticsReports.mockResolvedValue({
      total: 2,
      reports: [
        { id: 'r1', reportType: 'BRAND_CATALOG_PERFORMANCE', reportingPeriod: 'QUARTERLY',
          periodStart: '2026-01-01T00:00:00Z', periodEnd: '2026-03-31T00:00:00Z',
          status: 'COMPLETED', error: null, fetchedAt: new Date(Date.now() - 5 * 60_000).toISOString() },
        { id: 'r2', reportType: 'TOP_SEARCH_TERMS', reportingPeriod: 'MONTHLY',
          periodStart: '2026-04-01T00:00:00Z', periodEnd: '2026-04-30T00:00:00Z',
          status: 'FAILED', error: 'Request failed with status code 429', fetchedAt: new Date().toISOString() },
      ],
    });

    render(<ReportsList />);

    await waitFor(() => expect(screen.getByText('Completed')).toBeInTheDocument());
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText(/request failed with status code 429/i)).toBeInTheDocument();
  });
});

describe('ReportsList — manual trigger', () => {
  it('enqueues a fetch when "Fetch now" is clicked', async () => {
    const user = userEvent.setup();
    listBrandAnalyticsReports.mockResolvedValue({ reports: [] });
    triggerBrandAnalyticsFetch.mockResolvedValue({ message: 'Fetch enqueued.' });

    render(<ReportsList />);
    await waitFor(() => expect(screen.getByText('Top Search Terms')).toBeInTheDocument());

    // Find the Top Search Terms row and click its "Fetch now"
    const tstRow = screen.getByText('Top Search Terms').closest('div').parentElement;
    const fetchBtn = tstRow.querySelector('button');
    expect(fetchBtn).toHaveTextContent(/fetch now/i);

    await user.click(fetchBtn);

    await waitFor(() => expect(triggerBrandAnalyticsFetch).toHaveBeenCalledTimes(1));
    expect(triggerBrandAnalyticsFetch).toHaveBeenCalledWith({ reportType: 'TOP_SEARCH_TERMS' });
  });

  it('opens the SQP picker modal instead of firing the trigger', async () => {
    const user = userEvent.setup();
    listBrandAnalyticsReports.mockResolvedValue({ reports: [] });

    render(<ReportsList />);
    await waitFor(() => expect(screen.getByText('Search Query (Brand)')).toBeInTheDocument());

    // SQP_BRAND row → button should say "Pick ASINs…"
    const sqpRow = screen.getByText('Search Query (Brand)').closest('div').parentElement;
    const pickBtn = sqpRow.querySelector('button');
    expect(pickBtn).toHaveTextContent(/pick asins/i);

    await user.click(pickBtn);

    // Modal renders header
    await waitFor(() =>
      expect(screen.getByText(/fetch search query performance/i)).toBeInTheDocument()
    );

    // Importantly: SQP click should NOT have fired the direct trigger
    expect(triggerBrandAnalyticsFetch).not.toHaveBeenCalled();
  });

  it('disables the per-type button while a fetch is in flight', async () => {
    listBrandAnalyticsReports.mockResolvedValue({
      reports: [{
        id: 'r1', reportType: 'TOP_SEARCH_TERMS', reportingPeriod: 'MONTHLY',
        periodStart: '2026-04-01T00:00:00Z', periodEnd: '2026-04-30T00:00:00Z',
        status: 'PROCESSING', error: null, fetchedAt: new Date().toISOString(),
      }],
    });

    render(<ReportsList />);
    await waitFor(() => expect(screen.getByText('Processing')).toBeInTheDocument());

    const tstRow = screen.getByText('Top Search Terms').closest('div').parentElement;
    const btn = tstRow.querySelector('button');
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent(/running/i);
  });
});
