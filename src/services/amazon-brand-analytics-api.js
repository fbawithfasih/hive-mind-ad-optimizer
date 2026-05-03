/**
 * Amazon SP-API client for Brand Analytics reports.
 *
 * Wraps the Reports API (v2021-06-30) — createReport / getReport / getReportDocument —
 * for the eight Brand Analytics report types we ingest. Returns parsed JSON in the
 * same shape the legacy CSV parsers in services/brand-analytics/parser.js emit, so
 * downstream analytics code stays unchanged.
 *
 * Reuses the SP-API token manager from services/auth-utils.js — does NOT duplicate
 * refresh logic.
 */

import axios from 'axios';
import { gunzipSync } from 'zlib';
import { getOrCreateTokenManager } from './auth-utils.js';

// Same EU/FE marketplace mapping as amazon-sp-api.js
const EU_MARKETPLACES = new Set([
  'A1F83G8C2ARO7P','A1PA6795UKMFR9','A13V1IB3VIYZZH','APJ6JRA9NG5V4',
  'A1RKKUPIHCS9HS','A1805IZSGTT6HS','A2NODRKZP88ZB9','A1C3SOZHARKG6S',
  'AMEN7PMS3EDWL','A2VIGQ35RCS4UG','A17E79C6D8DWNP','A33AVAJ2PDY3EV',
  'ARBP9OOSHTCHU','A21TJRUUN4KGV',
]);
const FE_MARKETPLACES = new Set(['A1VC38T7YXB528','A39IBJ37TRP1C6','A19VAU5U5O7RUS']);

function spBaseForMarketplace(marketplaceId) {
  if (EU_MARKETPLACES.has(marketplaceId)) return 'https://sellingpartnerapi-eu.amazon.com';
  if (FE_MARKETPLACES.has(marketplaceId)) return 'https://sellingpartnerapi-fe.amazon.com';
  return 'https://sellingpartnerapi-na.amazon.com';
}

// ─── Logical type → SP-API reportType + reportOptions ─────────────────────────
//
// The strings on the right are Amazon's official reportType values for the
// Brand Analytics family. Period-of-coverage is controlled by reportOptions
// (e.g. 'reportPeriod': 'WEEK' | 'MONTH' | 'QUARTER').
//
const REPORT_TYPE_MAP = {
  SQP_BRAND: {
    reportType: 'GET_BRAND_ANALYTICS_SEARCH_QUERY_PERFORMANCE_REPORT',
    extraOptions: { asinGranularity: 'BRAND' },
  },
  SQP_ASIN: {
    reportType: 'GET_BRAND_ANALYTICS_SEARCH_QUERY_PERFORMANCE_REPORT',
    extraOptions: { asinGranularity: 'PARENT' },
  },
  TOP_SEARCH_TERMS: {
    reportType: 'GET_BRAND_ANALYTICS_SEARCH_TERMS_REPORT',
    extraOptions: {},
  },
  REPEAT_PURCHASE: {
    reportType: 'GET_BRAND_ANALYTICS_REPEAT_PURCHASE_REPORT',
    extraOptions: {},
  },
  MARKET_BASKET: {
    reportType: 'GET_BRAND_ANALYTICS_MARKET_BASKET_REPORT',
    extraOptions: {},
  },
  ITEM_COMPARISON_ALT_PURCHASE: {
    reportType: 'GET_BRAND_ANALYTICS_ITEM_COMPARISON_AND_ALTERNATE_PURCHASE_REPORT',
    extraOptions: {},
  },
  DEMOGRAPHICS: {
    reportType: 'GET_BRAND_ANALYTICS_DEMOGRAPHICS_REPORT',
    extraOptions: {},
  },
  BRAND_CATALOG_PERFORMANCE: {
    reportType: 'GET_BRAND_ANALYTICS_SEARCH_CATALOG_PERFORMANCE_REPORT',
    extraOptions: {},
  },
};

const PERIOD_TO_SP_OPTION = {
  WEEKLY:    'WEEK',
  MONTHLY:   'MONTH',
  QUARTERLY: 'QUARTER',
};

export function listSupportedReportTypes() {
  return Object.keys(REPORT_TYPE_MAP);
}

export function createBrandAnalyticsClient({
  clientId,
  clientSecret,
  refreshToken,
  marketplaceId = 'ATVPDKIKX0DER',
  cacheKey,
}) {
  const SP_BASE = spBaseForMarketplace(marketplaceId);
  const key = cacheKey ?? `sp:${clientId}:${(refreshToken ?? '').slice(-8)}`;

  async function getToken() {
    const m = getOrCreateTokenManager(key, clientId, clientSecret, refreshToken, 'SP-API');
    return m.getToken();
  }

  function headers(token) {
    return {
      Authorization:        `Bearer ${token}`,
      'x-amz-access-token': token,
      'Content-Type':       'application/json',
    };
  }

  /**
   * Submit a report request to Amazon. Returns the SP-API reportId.
   */
  async function createReport({ logicalType, reportingPeriod, periodStart, periodEnd }) {
    const map = REPORT_TYPE_MAP[logicalType];
    if (!map) throw new Error(`Unsupported Brand Analytics report type: ${logicalType}`);
    const reportPeriod = PERIOD_TO_SP_OPTION[reportingPeriod];
    if (!reportPeriod) throw new Error(`Unsupported reportingPeriod: ${reportingPeriod}`);

    const token = await getToken();
    const body = {
      reportType:     map.reportType,
      marketplaceIds: [marketplaceId],
      dataStartTime:  new Date(periodStart).toISOString(),
      dataEndTime:    new Date(periodEnd).toISOString(),
      reportOptions: { reportPeriod, ...map.extraOptions },
    };

    const res = await axios.post(`${SP_BASE}/reports/2021-06-30/reports`, body, {
      headers: headers(token),
    });
    return res.data.reportId;
  }

  /**
   * Poll the report status. Returns one of:
   *   { state: 'PENDING' }
   *   { state: 'FAILED', error }
   *   { state: 'DONE', reportDocumentId }
   */
  async function getReportStatus(reportId) {
    const token = await getToken();
    const r = await axios.get(`${SP_BASE}/reports/2021-06-30/reports/${reportId}`, {
      headers: headers(token),
    });
    const ps = r.data.processingStatus;
    if (ps === 'IN_QUEUE' || ps === 'IN_PROGRESS') return { state: 'PENDING' };
    if (ps === 'CANCELLED' || ps === 'FATAL')      return { state: 'FAILED', error: `Report ${ps}` };
    if (ps !== 'DONE')                              return { state: 'PENDING' };
    return { state: 'DONE', reportDocumentId: r.data.reportDocumentId };
  }

  /**
   * Download and parse the report document. Brand Analytics reports are
   * returned as JSON (not CSV) when fetched via the Reports API — the parser
   * here normalises that JSON into the same row shape the CSV parsers emit.
   *
   * When `raw` is true, the unparsed JSON object is returned instead of the
   * row-flattened normalised shape. Used by the debug capture path to inspect
   * Amazon's actual field names before tightening the normalisers.
   */
  async function downloadReport(reportDocumentId, logicalType, { raw = false } = {}) {
    const token = await getToken();
    const d = await axios.get(`${SP_BASE}/reports/2021-06-30/documents/${reportDocumentId}`, {
      headers: headers(token),
    });
    const dl = await axios.get(d.data.url, { responseType: 'arraybuffer' });
    const buf = Buffer.from(dl.data);
    const text = d.data.compressionAlgorithm === 'GZIP' ? gunzipSync(buf).toString() : buf.toString();
    const payload = JSON.parse(text);
    if (raw) {
      // Strip giant arrays down to a sample so the debug payload fits in DB
      // and stays readable. Keeps the full key shape at top level.
      return debugSamplePayload(payload);
    }
    return normaliseReport(logicalType, payload);
  }

  return { createReport, getReportStatus, downloadReport };
}

/**
 * Produce a small, key-preserving sample of an arbitrary BA payload —
 * keeps top-level shape, replaces any array > 5 entries with [first 3, '…', last 1]
 * so we can see what Amazon actually returns without persisting megabytes.
 */
function debugSamplePayload(p, depth = 0) {
  if (depth > 6) return '[...truncated depth]';
  if (Array.isArray(p)) {
    if (p.length <= 5) return p.map(x => debugSamplePayload(x, depth + 1));
    return [
      ...p.slice(0, 3).map(x => debugSamplePayload(x, depth + 1)),
      `… (${p.length - 4} more rows omitted)`,
      debugSamplePayload(p[p.length - 1], depth + 1),
    ];
  }
  if (p && typeof p === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(p)) out[k] = debugSamplePayload(v, depth + 1);
    return out;
  }
  return p;
}

// ─── Normalisers — JSON shape from Reports API → row shape from CSV parsers ───
//
// Brand Analytics reports return JSON arrays under different top-level keys
// depending on report type. These adapters keep `BrandAnalyticsReport.rawData`
// consistent with what services/brand-analytics/parser.js emits today, so the
// loader/analytics layer doesn't need to know the source.
//

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function str(v) { return (v ?? '').toString().trim(); }

function normaliseReport(logicalType, payload) {
  switch (logicalType) {
    case 'SQP_BRAND':
    case 'SQP_ASIN':                 return normaliseSqp(payload);
    case 'TOP_SEARCH_TERMS':         return normaliseTopSearchTerms(payload);
    case 'BRAND_CATALOG_PERFORMANCE':return normaliseCatalog(payload);
    case 'REPEAT_PURCHASE':
    case 'MARKET_BASKET':
    case 'ITEM_COMPARISON_ALT_PURCHASE':
    case 'DEMOGRAPHICS':
      // Pass through raw rows for now — analytics consumers for these report
      // types are net-new (Customer Retention, Cross-sell, Audience Targeting)
      // and will define their own shape when they land.
      return Array.isArray(payload) ? payload : (payload?.rows ?? payload?.data ?? []);
    default:
      return payload;
  }
}

function normaliseSqp(payload) {
  const rows = payload?.dataByDepartmentAndSearchTerm ?? payload?.rows ?? payload?.data ?? [];
  return rows.map(r => {
    const totalImpressions = num(r.impressions?.totalCount ?? r.totalImpressions);
    const brandImpressions = num(r.impressions?.brandCount ?? r.brandImpressions);
    const totalClicks      = num(r.clicks?.totalCount ?? r.totalClicks);
    const brandClicks      = num(r.clicks?.brandCount ?? r.brandClicks);
    const totalPurchases   = num(r.purchases?.totalCount ?? r.totalPurchases);
    const brandPurchases   = num(r.purchases?.brandCount ?? r.brandPurchases);
    return {
      searchTerm:       str(r.searchQuery ?? r.searchTerm),
      volume:           num(r.searchQueryVolume ?? r.volume),
      impressionShare:  num(r.impressions?.brandShare ?? (totalImpressions ? brandImpressions/totalImpressions*100 : 0)),
      clickShare:       num(r.clicks?.brandShare ?? (totalClicks ? brandClicks/totalClicks*100 : 0)),
      purchaseShare:    num(r.purchases?.brandShare ?? (totalPurchases ? brandPurchases/totalPurchases*100 : 0)),
      totalImpressions, brandImpressions,
      totalClicks,      brandClicks,
      totalPurchases,   brandPurchases,
      brandPrice:       num(r.clicks?.brandPriceMedian ?? r.brandPrice),
      marketPrice:      num(r.clicks?.priceMedian ?? r.marketPrice),
    };
  });
}

function normaliseCatalog(payload) {
  const rows = payload?.dataByAsin ?? payload?.rows ?? payload?.data ?? [];
  return rows.map(r => {
    const impressions = num(r.impressions?.impressions ?? r.impressions);
    const clicks      = num(r.clicks?.clicks ?? r.clicks);
    const purchases   = num(r.purchases?.purchases ?? r.purchases);
    return {
      asin:        str(r.asin ?? r.childAsin).toUpperCase(),
      title:       str(r.asinTitle ?? r.productTitle ?? r.title),
      category:    str(r.category ?? r.department),
      impressions, clicks,
      cartAdds:    num(r.cartAdds?.cartAdds ?? r.cartAdds),
      purchases,
      revenue:     num(r.purchases?.searchTrafficSales ?? r.revenue),
      convRate:    num(r.purchases?.conversionRate ?? (clicks ? purchases/clicks*100 : 0)),
      rating:      num(r.impressions?.ratingMedian ?? r.rating),
      price:       num(r.impressions?.priceMedian ?? r.price),
    };
  });
}

function normaliseTopSearchTerms(payload) {
  // Returns the raw rows (term, rank, top-3 ASINs) — full fan-out into
  // relevantKeywords/competitors/brandAppearances happens in the loader,
  // because that step needs orgId-specific brand ASINs as input.
  const rows = payload?.dataByDepartmentAndSearchTerm ?? payload?.rows ?? payload?.data ?? [];
  return rows.map(r => ({
    rank:       num(r.searchFrequencyRank ?? r.rank),
    searchTerm: str(r.searchTerm ?? r.searchQuery),
    top3: [
      { asin: str(r.topClickedProduct1?.asin).toUpperCase(),  title: str(r.topClickedProduct1?.title), clickShare: num(r.topClickedProduct1?.clickShare),  convShare: num(r.topClickedProduct1?.conversionShare),  position: 1 },
      { asin: str(r.topClickedProduct2?.asin).toUpperCase(),  title: str(r.topClickedProduct2?.title), clickShare: num(r.topClickedProduct2?.clickShare),  convShare: num(r.topClickedProduct2?.conversionShare),  position: 2 },
      { asin: str(r.topClickedProduct3?.asin).toUpperCase(),  title: str(r.topClickedProduct3?.title), clickShare: num(r.topClickedProduct3?.clickShare),  convShare: num(r.topClickedProduct3?.conversionShare),  position: 3 },
    ].filter(e => e.asin && e.asin.length >= 10),
  }));
}
