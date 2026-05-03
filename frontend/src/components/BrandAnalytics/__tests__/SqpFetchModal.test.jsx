import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SqpFetchModal from '../SqpFetchModal.jsx';

vi.mock('../../../services/api.js', () => ({
  listBrandAnalyticsReports:   vi.fn(),
  getBrandAnalyticsReport:     vi.fn(),
  triggerBrandAnalyticsFetch:  vi.fn(),
}));

import {
  listBrandAnalyticsReports,
  getBrandAnalyticsReport,
  triggerBrandAnalyticsFetch,
} from '../../../services/api.js';

function makeAsin(i) {
  return {
    asin:        `B${String(i).padStart(9, '0')}`,
    title:       `Product ${i}`,
    revenue:     1000 - i,
    impressions: 5000 - (i * 10),
  };
}

function mockCatalog(asins, periodEnd = '2026-04-30') {
  listBrandAnalyticsReports.mockResolvedValue({
    reports: [{ id: 'rpt_1', status: 'COMPLETED', periodStart: '2026-04-01', periodEnd }],
  });
  getBrandAnalyticsReport.mockResolvedValue({
    id:          'rpt_1',
    periodStart: '2026-04-01',
    periodEnd,
    rawData:     asins,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SqpFetchModal — selection cap (regression guard)', () => {
  it('caps selection at 17 ASINs (Amazon SP-API 200-char limit)', async () => {
    const user = userEvent.setup();
    mockCatalog(Array.from({ length: 25 }, (_, i) => makeAsin(i)));

    render(<SqpFetchModal onClose={() => {}} onSubmitted={() => {}} />);
    await waitFor(() => expect(screen.getByText(/25 .* ASINs selected|5\/17 ASINs selected/i)).toBeInTheDocument());

    // Default-select is top-5 by revenue. Try to add another 20 → should stop at 17.
    const checkboxes = screen.getAllByRole('checkbox');
    for (const cb of checkboxes) {
      if (!cb.checked) await user.click(cb);
    }

    // Counter shows 17/17 and last attempts were no-op
    expect(screen.getByText(/17\/17 ASINs selected/i)).toBeInTheDocument();
    const checked = checkboxes.filter(cb => cb.checked);
    expect(checked).toHaveLength(17);
  });

  it('default-selects top 5 by revenue', async () => {
    mockCatalog([
      { asin: 'B000000050', title: 'High',   revenue: 999, impressions: 1 },
      { asin: 'B000000051', title: 'Mid',    revenue: 500, impressions: 1 },
      { asin: 'B000000052', title: 'Low',    revenue: 100, impressions: 1 },
      { asin: 'B000000053', title: 'Lower',  revenue: 50,  impressions: 1 },
      { asin: 'B000000054', title: 'Lowest', revenue: 1,   impressions: 1 },
      { asin: 'B000000055', title: 'Zero',   revenue: 0,   impressions: 1 },
    ]);
    render(<SqpFetchModal onClose={() => {}} onSubmitted={() => {}} />);
    await waitFor(() => expect(screen.getByText(/5\/17 ASINs selected/i)).toBeInTheDocument());

    // Top 5 by revenue checked, the lowest-revenue row unchecked
    const lowestRow = screen.getByText('Zero').closest('label');
    expect(lowestRow.querySelector('input[type=checkbox]').checked).toBe(false);
  });
});

describe('SqpFetchModal — fetch submission', () => {
  it('submits the selected ASINs to triggerBrandAnalyticsFetch and calls onSubmitted', async () => {
    const user = userEvent.setup();
    const onSubmitted = vi.fn();
    const onClose     = vi.fn();
    mockCatalog([makeAsin(0), makeAsin(1), makeAsin(2)]);
    triggerBrandAnalyticsFetch.mockResolvedValue({ message: 'Fetch enqueued.' });

    render(<SqpFetchModal onClose={onClose} onSubmitted={onSubmitted} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /fetch sqp report/i })).toBeEnabled());

    await user.click(screen.getByRole('button', { name: /fetch sqp report/i }));

    await waitFor(() => expect(triggerBrandAnalyticsFetch).toHaveBeenCalledTimes(1));
    expect(triggerBrandAnalyticsFetch).toHaveBeenCalledWith({
      reportType: 'SQP_BRAND',
      asins:      ['B000000000', 'B000000001', 'B000000002'],
    });
    expect(onSubmitted).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('disables submit when no ASINs are selected', async () => {
    const user = userEvent.setup();
    mockCatalog([makeAsin(0)]);

    render(<SqpFetchModal onClose={() => {}} onSubmitted={() => {}} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /clear/i }));

    expect(screen.getByRole('button', { name: /fetch sqp report/i })).toBeDisabled();
  });

  it('surfaces server errors from a failed fetch', async () => {
    const user = userEvent.setup();
    mockCatalog([makeAsin(0)]);
    triggerBrandAnalyticsFetch.mockRejectedValue({
      response: { data: { error: 'Tier upgrade required' } },
    });

    render(<SqpFetchModal onClose={() => {}} onSubmitted={() => {}} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /fetch sqp report/i })).toBeEnabled());

    await user.click(screen.getByRole('button', { name: /fetch sqp report/i }));

    await waitFor(() => expect(screen.getByText(/tier upgrade required/i)).toBeInTheDocument());
  });
});

describe('SqpFetchModal — empty Catalog state', () => {
  it('shows a clear message when no Catalog Performance report exists yet', async () => {
    listBrandAnalyticsReports.mockResolvedValue({ reports: [] });

    render(<SqpFetchModal onClose={() => {}} onSubmitted={() => {}} />);

    await waitFor(() =>
      expect(screen.getByText(/no completed catalog performance report yet/i)).toBeInTheDocument()
    );
    expect(getBrandAnalyticsReport).not.toHaveBeenCalled();
  });
});
