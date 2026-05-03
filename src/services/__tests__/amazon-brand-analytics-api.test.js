/**
 * Tests for the Brand Analytics SP-API client surface.
 *
 * Covers the field-mapping normalisers (which had two prod regressions —
 * Catalog all-zeros and Catalog category-empty), the report-type registry
 * (apiAvailable + requiresAsin gating), and the debug sampler that captures
 * raw payloads for normaliser calibration.
 */

import {
  listSupportedReportTypes,
  listApiAvailableReportTypes,
  reportTypeRequiresAsin,
  __testables,
} from '../amazon-brand-analytics-api.js';

const {
  normaliseReport,
  normaliseCatalog,
  normaliseSqp,
  normaliseTopSearchTerms,
  normaliseTopSearchTermsRow,
  debugSamplePayload,
  TOP_LEVEL_ARRAY_KEY,
} = __testables;

describe('Brand Analytics — report type registry', () => {
  it('lists every logical report type, including dashboard-only ones', () => {
    const all = listSupportedReportTypes();
    expect(all).toEqual(expect.arrayContaining([
      'SQP_BRAND', 'SQP_ASIN', 'TOP_SEARCH_TERMS', 'REPEAT_PURCHASE',
      'MARKET_BASKET', 'BRAND_CATALOG_PERFORMANCE',
      'ITEM_COMPARISON_ALT_PURCHASE', 'DEMOGRAPHICS',
    ]));
  });

  it('omits dashboard-only types from the API-available subset', () => {
    const api = listApiAvailableReportTypes();
    expect(api).not.toContain('ITEM_COMPARISON_ALT_PURCHASE');
    expect(api).not.toContain('DEMOGRAPHICS');
    expect(api).toContain('TOP_SEARCH_TERMS');
    expect(api).toContain('BRAND_CATALOG_PERFORMANCE');
    expect(api).toContain('REPEAT_PURCHASE');
  });

  it('flags only SQP variants as requiring an asin list', () => {
    expect(reportTypeRequiresAsin('SQP_BRAND')).toBe(true);
    expect(reportTypeRequiresAsin('SQP_ASIN')).toBe(true);
    expect(reportTypeRequiresAsin('TOP_SEARCH_TERMS')).toBe(false);
    expect(reportTypeRequiresAsin('BRAND_CATALOG_PERFORMANCE')).toBe(false);
    expect(reportTypeRequiresAsin('REPEAT_PURCHASE')).toBe(false);
    expect(reportTypeRequiresAsin('MARKET_BASKET')).toBe(false);
  });

  it('registers a top-level array key for every API-fetchable report', () => {
    for (const type of listApiAvailableReportTypes()) {
      expect(TOP_LEVEL_ARRAY_KEY[type]).toBeTruthy();
    }
  });
});

describe('normaliseCatalog — Catalog Performance row mapping', () => {
  // Real shape captured from prod via debug-mode (2026-05-04). Each metric
  // is wrapped under a *Data sub-object; medians/sales are { amount,
  // currencyCode } objects; conversionRate is a 0-1 fraction.
  const realPayload = {
    dataByAsin: [
      {
        asin: 'B0DW46MR5R',
        startDate: '2026-04-01',
        endDate:   '2026-04-30',
        impressionData: { impressionCount: 13443, impressionMedianPrice: { amount: 31.99, currencyCode: 'USD' } },
        clickData:      { clickCount: 200, clickRate: 0.0149, clickedMedianPrice: { amount: 31.99, currencyCode: 'USD' } },
        cartAddData:    { cartAddCount: 52,  cartAddedMedianPrice: { amount: 31.99, currencyCode: 'USD' } },
        purchaseData:   {
          purchaseCount: 5,
          conversionRate: 0.025,
          searchTrafficSales: { amount: 262.93, currencyCode: 'USD' },
          purchaseMedianPrice: { amount: 31.99, currencyCode: 'USD' },
        },
      },
      {
        asin: 'B07H5GG7HJ',
        impressionData: { impressionCount: 24, impressionMedianPrice: { amount: 149, currencyCode: 'USD' } },
        clickData:      { clickCount: 0,  clickedMedianPrice: null },
        cartAddData:    { cartAddCount: 0 },
        purchaseData:   { purchaseCount: 0, conversionRate: null, searchTrafficSales: { amount: 0 } },
      },
    ],
  };

  it('extracts every metric from the nested *Data sub-objects', () => {
    const rows = normaliseCatalog(realPayload);
    expect(rows).toHaveLength(2);
    const top = rows[0];
    expect(top.asin).toBe('B0DW46MR5R');
    expect(top.impressions).toBe(13443);
    expect(top.clicks).toBe(200);
    expect(top.cartAdds).toBe(52);
    expect(top.purchases).toBe(5);
    expect(top.revenue).toBe(262.93);
  });

  it('converts Amazon\'s 0-1 conversionRate fraction into percent', () => {
    const [top] = normaliseCatalog(realPayload);
    expect(top.convRate).toBeCloseTo(2.5, 5);   // 0.025 → 2.5%
  });

  it('reads price from impressionMedianPrice (not flat key)', () => {
    const [top] = normaliseCatalog(realPayload);
    expect(top.price).toBe(31.99);
  });

  it('falls back to clicks-based conversion when conversionRate is null', () => {
    const payload = { dataByAsin: [{
      asin: 'B0NULLCONV1',
      clickData:    { clickCount: 200 },
      purchaseData: { purchaseCount: 5, conversionRate: null },
    }]};
    const [r] = normaliseCatalog(payload);
    expect(r.convRate).toBeCloseTo(2.5, 5); // 5/200 = 2.5%
  });

  it('zeroes safely when whole sub-objects are missing', () => {
    const [_, sparse] = normaliseCatalog(realPayload);
    expect(sparse.asin).toBe('B07H5GG7HJ');
    expect(sparse.impressions).toBe(24);
    expect(sparse.clicks).toBe(0);
    expect(sparse.purchases).toBe(0);
    expect(sparse.revenue).toBe(0);
    expect(sparse.convRate).toBe(0);
  });

  it('uppercases ASINs', () => {
    const [r] = normaliseCatalog({ dataByAsin: [{ asin: 'b0lower123' }] });
    expect(r.asin).toBe('B0LOWER123');
  });

  it('returns empty array for payload without a known array key', () => {
    expect(normaliseCatalog({})).toEqual([]);
    expect(normaliseCatalog({ dataByAsin: [] })).toEqual([]);
    expect(normaliseCatalog(null)).toEqual([]);
  });
});

describe('normaliseSqp — Search Query Performance row mapping', () => {
  const payload = {
    dataByDepartmentAndSearchTerm: [
      {
        searchQuery: 'marble salt cellar',
        searchQueryVolume: 12000,
        impressions: { totalCount: 50000, brandCount: 8000,  brandShare: 16 },
        clicks:      { totalCount: 1500,  brandCount: 300,   brandShare: 20, brandPriceMedian: 31.99, priceMedian: 28.5 },
        purchases:   { totalCount: 80,    brandCount: 25,    brandShare: 31.25 },
      },
    ],
  };

  it('extracts impressions/clicks/purchases per query', () => {
    const [r] = normaliseSqp(payload);
    expect(r.searchTerm).toBe('marble salt cellar');
    expect(r.volume).toBe(12000);
    expect(r.totalImpressions).toBe(50000);
    expect(r.brandImpressions).toBe(8000);
    expect(r.totalClicks).toBe(1500);
    expect(r.brandClicks).toBe(300);
    expect(r.totalPurchases).toBe(80);
    expect(r.brandPurchases).toBe(25);
  });

  it('uses Amazon\'s brandShare fields when present', () => {
    const [r] = normaliseSqp(payload);
    expect(r.impressionShare).toBe(16);
    expect(r.clickShare).toBe(20);
    expect(r.purchaseShare).toBe(31.25);
  });

  it('derives shares from counts when brandShare is absent', () => {
    const minimal = {
      dataByDepartmentAndSearchTerm: [{
        searchQuery: 'foo',
        impressions: { totalCount: 100, brandCount: 25 },
        clicks:      { totalCount: 10,  brandCount: 2 },
        purchases:   { totalCount: 1,   brandCount: 0 },
      }],
    };
    const [r] = normaliseSqp(minimal);
    expect(r.impressionShare).toBe(25); // 25/100*100
    expect(r.clickShare).toBe(20);      // 2/10*100
    expect(r.purchaseShare).toBe(0);
  });

  it('extracts brandPrice + marketPrice medians from clicks', () => {
    const [r] = normaliseSqp(payload);
    expect(r.brandPrice).toBe(31.99);
    expect(r.marketPrice).toBe(28.5);
  });
});

describe('normaliseTopSearchTerms — TST row mapping', () => {
  it('keeps only top-3 entries with a valid 10+ char ASIN', () => {
    const r = normaliseTopSearchTermsRow({
      searchFrequencyRank: 17,
      searchTerm: 'queenza salt',
      topClickedProduct1: { asin: 'B0DW46MR5R', title: 'A',  clickShare: 0.4, conversionShare: 0.1 },
      topClickedProduct2: { asin: 'short',      title: 'B' }, // bogus ASIN — must be filtered
      topClickedProduct3: { asin: 'B08N1B3W2G', title: 'C' },
    });
    expect(r.rank).toBe(17);
    expect(r.searchTerm).toBe('queenza salt');
    expect(r.top3).toHaveLength(2);
    expect(r.top3.map(e => e.asin)).toEqual(['B0DW46MR5R', 'B08N1B3W2G']);
    expect(r.top3[0].position).toBe(1);
    expect(r.top3[1].position).toBe(3);
  });

  it('aggregates many rows in normaliseTopSearchTerms', () => {
    const out = normaliseTopSearchTerms({
      dataByDepartmentAndSearchTerm: [
        { searchTerm: 'a', searchFrequencyRank: 1, topClickedProduct1: { asin: 'B000000001' } },
        { searchTerm: 'b', searchFrequencyRank: 2, topClickedProduct1: { asin: 'B000000002' } },
      ],
    });
    expect(out).toHaveLength(2);
    expect(out[0].searchTerm).toBe('a');
  });
});

describe('normaliseReport — top-level dispatch', () => {
  it('routes each logical type to its specific normaliser', () => {
    expect(normaliseReport('BRAND_CATALOG_PERFORMANCE', { dataByAsin: [{ asin: 'B0X' }] }))
      .toEqual([expect.objectContaining({ asin: 'B0X' })]);
    expect(normaliseReport('SQP_BRAND', { dataByDepartmentAndSearchTerm: [{ searchQuery: 'q' }] }))
      .toEqual([expect.objectContaining({ searchTerm: 'q' })]);
  });

  it('passes pass-through types as-is', () => {
    const rows = [{ a: 1 }, { a: 2 }];
    expect(normaliseReport('REPEAT_PURCHASE', rows)).toBe(rows);
    expect(normaliseReport('MARKET_BASKET', { rows })).toBe(rows);
  });
});

describe('debugSamplePayload — shape-preserving truncation', () => {
  it('keeps small arrays whole', () => {
    expect(debugSamplePayload([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('truncates long arrays to first 3 + marker + last', () => {
    const arr = Array.from({ length: 100 }, (_, i) => i);
    const out = debugSamplePayload(arr);
    expect(out).toHaveLength(5);
    expect(out[0]).toBe(0);
    expect(out[2]).toBe(2);
    expect(typeof out[3]).toBe('string');           // the marker line
    expect(out[3]).toContain('96 more rows omitted');
    expect(out[4]).toBe(99);
  });

  it('preserves object key shape', () => {
    const out = debugSamplePayload({ a: 1, b: { c: [1, 2, 3] }, d: 'x' });
    expect(out).toEqual({ a: 1, b: { c: [1, 2, 3] }, d: 'x' });
  });

  it('caps recursion depth so cyclic-ish nesting is safe', () => {
    let nested = 'leaf';
    for (let i = 0; i < 12; i++) nested = { deeper: nested };
    const out = debugSamplePayload(nested);
    // Should not throw; should produce a string sentinel somewhere along the chain
    const flat = JSON.stringify(out);
    expect(flat).toContain('truncated');
  });
});
