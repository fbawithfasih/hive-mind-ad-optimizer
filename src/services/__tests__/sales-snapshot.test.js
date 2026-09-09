/**
 * What a nightly snapshot covers, and what it keeps.
 */
import {
  snapshotWindow, snapshotJobId, snapshotResult,
  SNAPSHOT_DAYS, LAG_DAYS, MAX_ASINS,
} from '../sales-snapshot.js';

const NOW = new Date('2026-09-10T02:30:00Z');

describe('the window', () => {
  it('ends yesterday, because today is still being written', () => {
    // Sales and Traffic lags; asking for today returns a partial day and the
    // numbers move under you.
    expect(snapshotWindow(NOW)).toEqual({ startDate: '2026-09-03', endDate: '2026-09-09' });
    expect(LAG_DAYS).toBe(1);
  });

  it('covers a week, not a day', () => {
    // A Buy Box dip on a quiet Tuesday looks like a crisis on its own, and
    // Amazon restates recent days as orders settle.
    const { startDate, endDate } = snapshotWindow(NOW);
    const days = (Date.parse(endDate) - Date.parse(startDate)) / 86_400_000 + 1;
    expect(days).toBe(SNAPSHOT_DAYS);
  });

  it('gives one job id per org per day', () => {
    expect(snapshotJobId('org-1', NOW)).toBe('sales:org-1:2026-09-10');
    expect(snapshotJobId('org-1', new Date('2026-09-11T02:30:00Z'))).not.toBe(snapshotJobId('org-1', NOW));
  });
});

describe('what is stored', () => {
  const win = { startDate: '2026-09-03', endDate: '2026-09-09' };
  const asin = (over = {}) => ({
    asin: 'A', unitsOrdered: 5, orderedSales: 100, sessions: 100, pageViews: 120,
    buyBoxPercentage: 95, noSalesDespiteTraffic: false, ...over,
  });

  it('keeps the totals and the window it covers', () => {
    const r = snapshotResult({ totalSales: 1234.5, currency: 'USD', days: 7, asins: [asin()] }, win);
    expect(r).toMatchObject({ window: win, totalSales: 1234.5, currency: 'USD', days: 7, asinCount: 1, truncated: false });
  });

  it('puts the ASINs in trouble first', () => {
    const r = snapshotResult({ asins: [
      asin({ asin: 'fine',    buyBoxPercentage: 99 }),
      asin({ asin: 'stuck',   noSalesDespiteTraffic: true, buyBoxPercentage: 80 }),
      asin({ asin: 'losing',  buyBoxPercentage: 40 }),
    ] }, win);
    expect(r.asins.map((a) => a.asin)).toEqual(['stuck', 'losing', 'fine']);
  });

  it('treats an unknown Buy Box as fine rather than as a problem', () => {
    // Absence of a figure is not evidence of one; sorting it to the top would
    // put every ASIN Amazon says nothing about ahead of real trouble.
    const r = snapshotResult({ asins: [asin({ asin: 'unknown', buyBoxPercentage: null }), asin({ asin: 'low', buyBoxPercentage: 30 })] }, win);
    expect(r.asins[0].asin).toBe('low');
  });

  it('breaks a tie on Buy Box by who gets the most traffic', () => {
    const r = snapshotResult({ asins: [
      asin({ asin: 'quiet', buyBoxPercentage: 50, sessions: 10 }),
      asin({ asin: 'busy',  buyBoxPercentage: 50, sessions: 900 }),
    ] }, win);
    expect(r.asins[0].asin).toBe('busy');
  });

  it('caps a large catalogue and says that it did', () => {
    // The row is read nightly by an evaluator that only cares about the ones
    // in trouble; a full catalogue would put megabytes behind that.
    const many = Array.from({ length: MAX_ASINS + 25 }, (_, i) => asin({ asin: `A${i}` }));
    const r = snapshotResult({ asins: many }, win);
    expect(r.asins).toHaveLength(MAX_ASINS);
    expect(r).toMatchObject({ asinCount: MAX_ASINS + 25, truncated: true });
  });

  it('survives a report with nothing in it', () => {
    expect(snapshotResult(null, win)).toMatchObject({ totalSales: 0, asinCount: 0, truncated: false, asins: [] });
  });
});
