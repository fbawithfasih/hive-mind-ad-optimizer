/**
 * The half of the Sales & Traffic report that was being thrown away.
 *
 * The report is created with asinGranularity: PARENT, so Amazon returns
 * `salesAndTrafficByAsin` alongside the daily totals — Buy Box share,
 * sessions, units — and the poller parsed the dates and dropped the rest. The
 * one number sellers ask about most was arriving every time and never
 * surfacing.
 */
jest.mock('../http.js', () => ({
  http: { get: jest.fn(), post: jest.fn() },
  TIMEOUT_MS: { api: 30000, token: 15000, download: 120000, llm: 120000 },
  fetchWithTimeout: jest.fn(),
  isTimeout: jest.fn(() => false),
}));

import { http } from '../http.js';
import { createSpApiClient } from '../amazon-sp-api.js';

const client = () => createSpApiClient({
  clientId: 'c', clientSecret: 's', refreshToken: 'r', sellerId: 'A1', marketplaceId: 'ATVPDKIKX0DER', cacheKey: 'sp:test',
});

/** Wire up: token → report DONE → document → payload download. */
function respondWith(payload) {
  http.post.mockResolvedValueOnce({ data: { access_token: 'tok', expires_in: 3600 } });
  http.get
    .mockResolvedValueOnce({ data: { processingStatus: 'DONE', reportDocumentId: 'doc-1' } })
    .mockResolvedValueOnce({ data: { url: 'https://example.com/doc', compressionAlgorithm: null } })
    .mockResolvedValueOnce({ data: Buffer.from(JSON.stringify(payload)) });
}

const asinRow = (over = {}) => ({
  parentAsin: 'B0BRASS01',
  salesByAsin:   { unitsOrdered: 12, orderedProductSales: { amount: 288.5, currencyCode: 'USD' } },
  trafficByAsin: { sessions: 300, pageViews: 420, buyBoxPercentage: 92.5 },
  ...over,
});

const payload = (asins = [asinRow()]) => ({
  salesAndTrafficByDate: [{ salesByDate: { orderedProductSales: { amount: 100, currencyCode: 'USD' } } }],
  salesAndTrafficByAsin: asins,
});

beforeEach(() => { jest.clearAllMocks(); http.get.mockReset(); http.post.mockReset(); });

it('returns the daily totals it always did', async () => {
  respondWith(payload());
  const out = await client().pollSalesAndTrafficReport('r-1');
  expect(out).toMatchObject({ status: 'COMPLETED', totalSales: 100, currency: 'USD', days: 1 });
});

it('returns Buy Box share, sessions and units per ASIN', async () => {
  respondWith(payload());
  const [asin] = (await client().pollSalesAndTrafficReport('r-1')).asins;
  expect(asin).toEqual({
    asin: 'B0BRASS01', unitsOrdered: 12, orderedSales: 288.5,
    sessions: 300, pageViews: 420, buyBoxPercentage: 92.5, noSalesDespiteTraffic: false,
  });
});

it('reports a missing Buy Box figure as unknown, not as zero', async () => {
  // They mean opposite things, and only one is worth waking someone about.
  respondWith(payload([asinRow({ trafficByAsin: { sessions: 10, pageViews: 12 } })]));
  const [asin] = (await client().pollSalesAndTrafficReport('r-1')).asins;
  expect(asin.buyBoxPercentage).toBeNull();
});

it('flags traffic with no sales — the shape of a stock-out or a lost Buy Box', async () => {
  respondWith(payload([asinRow({ salesByAsin: { unitsOrdered: 0 }, trafficByAsin: { sessions: 240, buyBoxPercentage: 0 } })]));
  const [asin] = (await client().pollSalesAndTrafficReport('r-1')).asins;
  expect(asin).toMatchObject({ unitsOrdered: 0, sessions: 240, noSalesDespiteTraffic: true });
});

it('does not flag a listing nobody visited', async () => {
  // No sessions and no sales is a listing with no traffic, not a stock-out.
  respondWith(payload([asinRow({ salesByAsin: { unitsOrdered: 0 }, trafficByAsin: { sessions: 0 } })]));
  expect((await client().pollSalesAndTrafficReport('r-1')).asins[0].noSalesDespiteTraffic).toBe(false);
});

it('drops a row with no ASIN rather than reporting a nameless one', async () => {
  respondWith(payload([asinRow({ parentAsin: undefined })]));
  expect((await client().pollSalesAndTrafficReport('r-1')).asins).toEqual([]);
});

it('answers with an empty list when the payload carries no ASIN section', async () => {
  respondWith({ salesAndTrafficByDate: [] });
  const out = await client().pollSalesAndTrafficReport('r-1');
  expect(out.asins).toEqual([]);
  expect(out.status).toBe('COMPLETED');
});
