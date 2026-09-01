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

import { http, TIMEOUT_MS } from './http.js';
import { gunzipSync, createGunzip } from 'zlib';
import jsonParser from 'stream-json';
import streamArrayMod from 'stream-json/streamers/stream-array.js';
import pickMod from 'stream-json/filters/pick.js';
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

// ─── Logical type → SP-API reportType + option requirements ──────────────────
//
// Calibrated against the SP-API docs at
// https://developer-docs.amazon.com/sp-api/docs/report-type-values-analytics
//
//  - `requiresAsin: true` means the SP-API report won't run unless the caller
//    supplies a space-separated ASIN list under reportOptions.asin.
//  - `apiAvailable: false` flags reports that exist in the Brand Analytics
//    dashboard but are NOT exposed via the Reports API. Requests for these
//    types short-circuit with a clear error rather than being submitted.
//
const REPORT_TYPE_MAP = {
  // SQP: brand-vs-ASIN view is NOT a separate report type. The single SP-API
  // report returns SQP for the ASINs you specify via reportOptions.asin
  // (required). For backwards compat we keep both logical aliases.
  SQP_BRAND: {
    reportType:    'GET_BRAND_ANALYTICS_SEARCH_QUERY_PERFORMANCE_REPORT',
    requiresAsin:  true,
    apiAvailable:  true,
  },
  SQP_ASIN: {
    reportType:    'GET_BRAND_ANALYTICS_SEARCH_QUERY_PERFORMANCE_REPORT',
    requiresAsin:  true,
    apiAvailable:  true,
  },
  TOP_SEARCH_TERMS: {
    reportType:    'GET_BRAND_ANALYTICS_SEARCH_TERMS_REPORT',
    apiAvailable:  true,
  },
  REPEAT_PURCHASE: {
    reportType:    'GET_BRAND_ANALYTICS_REPEAT_PURCHASE_REPORT',
    apiAvailable:  true,
  },
  MARKET_BASKET: {
    reportType:    'GET_BRAND_ANALYTICS_MARKET_BASKET_REPORT',
    apiAvailable:  true,
  },
  BRAND_CATALOG_PERFORMANCE: {
    reportType:    'GET_BRAND_ANALYTICS_SEARCH_CATALOG_PERFORMANCE_REPORT',
    apiAvailable:  true,
  },
  // Dashboard-only — no Reports API endpoint as of the 2026-05 docs.
  // Insight surfaces still exist in our API but will return 404 until Amazon
  // exposes these reports.
  ITEM_COMPARISON_ALT_PURCHASE: {
    reportType:    'GET_BRAND_ANALYTICS_ITEM_COMPARISON_AND_ALTERNATE_PURCHASE_REPORT',
    apiAvailable:  false,
  },
  DEMOGRAPHICS: {
    reportType:    'GET_BRAND_ANALYTICS_DEMOGRAPHICS_REPORT',
    apiAvailable:  false,
  },
};

const PERIOD_TO_SP_OPTION = {
  WEEKLY:    'WEEK',
  MONTHLY:   'MONTH',
  QUARTERLY: 'QUARTER',
};

/**
 * Errors Amazon will answer identically however many times we resend.
 *
 * A missing report type, a dashboard-only report, a malformed ASIN list and a
 * report Amazon marked FATAL are all settled questions — retrying re-asks a
 * question already answered, and for BA that costs five attempts of up to
 * thirty minutes' polling each. Callers translate the flag into whatever their
 * runtime uses to stop retrying (the fetch worker raises BullMQ's
 * UnrecoverableError); the flag itself keeps this module free of that
 * dependency.
 */
export function terminalError(message) {
  const err = new Error(message);
  err.terminal = true;
  return err;
}

/**
 * Reduce a fatal report document to one line worth logging.
 *
 * Amazon is not consistent about the shape: some report types return
 * { errorDetails: [...] }, others `errors` or `messages`, and a few return
 * plain text. Anything unrecognised falls back to the raw prefix rather than
 * being dropped — an unparsed reason still beats no reason.
 *
 * Exported for tests: it is the part worth asserting on and it needs no HTTP.
 */
export function summariseFatalDocument(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return null;

  let payload;
  try { payload = JSON.parse(trimmed); } catch { return trimmed.slice(0, 300); }

  const found = payload?.errorDetails ?? payload?.errors ?? payload?.messages;
  const messages = (Array.isArray(found) ? found : [found])
    .filter(Boolean)
    .map(e => (typeof e === 'string'
      ? e
      : e.message ?? e.detail ?? e.errorMessage ?? JSON.stringify(e)))
    .filter(Boolean);

  return (messages.length ? messages.join('; ') : trimmed).slice(0, 300);
}

export function listSupportedReportTypes() {
  return Object.keys(REPORT_TYPE_MAP);
}

/**
 * Subset of supported reports actually fetchable via SP-API today.
 * Used by the daily scheduler to skip dashboard-only types.
 */
export function listApiAvailableReportTypes() {
  return Object.entries(REPORT_TYPE_MAP)
    .filter(([, m]) => m.apiAvailable)
    .map(([k]) => k);
}

export function reportTypeRequiresAsin(logicalType) {
  return !!REPORT_TYPE_MAP[logicalType]?.requiresAsin;
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
   *
   * @param {object} params
   * @param {string}   params.logicalType
   * @param {string}   params.reportingPeriod  WEEKLY | MONTHLY | QUARTERLY
   * @param {Date|string} params.periodStart
   * @param {Date|string} params.periodEnd
   * @param {string[]}  [params.asins]  Required for SQP — space-separated list, ≤200 chars.
   */
  async function createReport({ logicalType, reportingPeriod, periodStart, periodEnd, asins = [] }) {
    const map = REPORT_TYPE_MAP[logicalType];
    if (!map) throw terminalError(`Unsupported Brand Analytics report type: ${logicalType}`);
    if (!map.apiAvailable) {
      throw terminalError(`${logicalType} is dashboard-only — Amazon does not expose it via the SP-API Reports API.`);
    }
    const reportPeriod = PERIOD_TO_SP_OPTION[reportingPeriod];
    if (!reportPeriod) throw terminalError(`Unsupported reportingPeriod: ${reportingPeriod}`);
    if (map.requiresAsin && (!Array.isArray(asins) || asins.length === 0)) {
      throw terminalError(`${logicalType} requires an asin list — pass { asins: ["B0...", ...] } in the job/refresh payload.`);
    }

    const reportOptions = { reportPeriod };
    if (asins.length) {
      // SP-API expects space-separated ASIN string with ≤200-char limit.
      const joined = asins.join(' ');
      if (joined.length > 200) throw terminalError('ASIN list exceeds the 200-char SP-API limit; chunk into multiple jobs.');
      reportOptions.asin = joined;
    }

    const token = await getToken();
    const body = {
      reportType:     map.reportType,
      marketplaceIds: [marketplaceId],
      dataStartTime:  new Date(periodStart).toISOString(),
      dataEndTime:    new Date(periodEnd).toISOString(),
      reportOptions,
    };

    const res = await http.post(`${SP_BASE}/reports/2021-06-30/reports`, body, {
      headers: headers(token),
    });
    return res.data.reportId;
  }

  /**
   * Read Amazon's explanation for a report it refused to produce.
   *
   * A FATAL or CANCELLED report still carries a reportDocumentId, and that
   * document holds the reason. We were discarding it and recording the bare
   * string "Report FATAL", which cannot distinguish "this seller is not brand
   * registered" from "that date range is not a closed BA period" — so a daily
   * sweep failing across every org said nothing about why.
   *
   * Best-effort by design: if the detail cannot be read, the caller falls back
   * to the bare status. Replacing Amazon's reason with our own download error
   * would be strictly worse than having no detail at all.
   */
  async function fatalReason(reportDocumentId) {
    if (!reportDocumentId) return null;
    try {
      const token = await getToken();
      const d = await http.get(`${SP_BASE}/reports/2021-06-30/documents/${reportDocumentId}`, {
        headers: headers(token),
      });
      const dl  = await http.get(d.data.url, { responseType: 'arraybuffer', timeout: TIMEOUT_MS.download });
      const buf = Buffer.from(dl.data);
      const text = (d.data.compressionAlgorithm === 'GZIP' ? gunzipSync(buf) : buf).toString();
      return summariseFatalDocument(text);
    } catch {
      return null;
    }
  }

  /**
   * Poll the report status. Returns one of:
   *   { state: 'PENDING' }
   *   { state: 'FAILED', error }
   *   { state: 'DONE', reportDocumentId }
   */
  async function getReportStatus(reportId) {
    const token = await getToken();
    const r = await http.get(`${SP_BASE}/reports/2021-06-30/reports/${reportId}`, {
      headers: headers(token),
    });
    const ps = r.data.processingStatus;
    if (ps === 'IN_QUEUE' || ps === 'IN_PROGRESS') return { state: 'PENDING' };
    if (ps === 'CANCELLED' || ps === 'FATAL') {
      const reason = await fatalReason(r.data.reportDocumentId);
      return {
        state:    'FAILED',
        terminal: true,
        error:    reason ? `Report ${ps}: ${reason}` : `Report ${ps} (Amazon supplied no detail)`,
      };
    }
    if (ps !== 'DONE')                              return { state: 'PENDING' };
    return { state: 'DONE', reportDocumentId: r.data.reportDocumentId };
  }

  /**
   * Download and parse the report document. Brand Analytics reports are
   * returned as JSON (not CSV) when fetched via the Reports API — the parser
   * here normalises that JSON into the same row shape the CSV parsers emit.
   *
   * Top Search Terms reports can exceed 470MB uncompressed, blowing past V8's
   * 536MB max string length. For those we stream the gzip → JSON-parser pipe
   * row-by-row instead of buffering the whole payload.
   *
   * When `raw` is true, returns a sampled snapshot of the payload (debug mode).
   */
  async function downloadReport(reportDocumentId, logicalType, { raw = false } = {}) {
    const token = await getToken();
    const d = await http.get(`${SP_BASE}/reports/2021-06-30/documents/${reportDocumentId}`, {
      headers: headers(token),
    });

    const isGzip = d.data.compressionAlgorithm === 'GZIP';
    const arrayKey = TOP_LEVEL_ARRAY_KEY[logicalType];

    // Stream path — required for Top Search Terms (massive payload). Used only
    // for production normalisation; debug capture still buffers (it produces a
    // small sample so memory isn't a concern, and it needs the surrounding
    // metadata that the streaming path discards).
    if (!raw && arrayKey && logicalType === 'TOP_SEARCH_TERMS') {
      return streamAndNormalise(d.data.url, isGzip, arrayKey, logicalType);
    }

    // Buffer path — fine for Catalog/SQP/Repeat-Purchase/Market-Basket whose
    // payloads stay well under the V8 string limit.
    const dl = await http.get(d.data.url, { responseType: 'arraybuffer', timeout: TIMEOUT_MS.download });
    const buf = Buffer.from(dl.data);
    const text = isGzip ? gunzipSync(buf).toString() : buf.toString();
    const payload = JSON.parse(text);
    if (raw) return debugSamplePayload(payload);
    return normaliseReport(logicalType, payload);
  }

  return { createReport, getReportStatus, downloadReport };
}

/**
 * Top-level array key per report type — needed by the streaming JSON parser
 * to drill down without holding the whole document in memory.
 */
const TOP_LEVEL_ARRAY_KEY = {
  TOP_SEARCH_TERMS:          'dataByDepartmentAndSearchTerm',
  SQP_BRAND:                 'dataByDepartmentAndSearchTerm',
  SQP_ASIN:                  'dataByDepartmentAndSearchTerm',
  BRAND_CATALOG_PERFORMANCE: 'dataByAsin',
  REPEAT_PURCHASE:           'dataByAsin',
  MARKET_BASKET:             'dataByAsin',
};

/**
 * Stream the report document, parse JSON incrementally, normalise each row,
 * and return the accumulated normalised array.
 *
 * MEMORY BOUND: Top Search Terms can return millions of rank rows for a
 * marketplace, which OOMs the container even when the JSON parse is streamed.
 * Real prod incident on 2026-05-04 surfaced this. We cap retention at
 * STREAM_ROW_CAP rows; since the BA report is sorted by searchFrequencyRank
 * the top N captures the most-searched (and most-actionable) terms.
 */
const STREAM_ROW_CAP = 100_000;

async function streamAndNormalise(url, isGzip, arrayKey, logicalType) {
  const response = await http.get(url, { responseType: 'stream' });
  const rowNormaliser = STREAM_ROW_NORMALISERS[logicalType];
  if (!rowNormaliser) {
    throw new Error(`No streaming row normaliser registered for ${logicalType}`);
  }

  return new Promise((resolve, reject) => {
    const rows = [];
    let stream = response.data;
    if (isGzip) stream = stream.pipe(createGunzip());
    const out = stream
      .pipe(jsonParser())
      .pipe(pickMod.asStream({ filter: arrayKey }))
      .pipe(streamArrayMod.asStream());

    out.on('data', ({ value }) => {
      if (rows.length >= STREAM_ROW_CAP) {
        // Past the cap — drain remaining bytes into /dev/null so the axios
        // socket closes cleanly. Don't .destroy() the upstream (leaks socket).
        return;
      }
      const row = rowNormaliser(value);
      if (row) rows.push(row);
    });
    out.on('end',   () => resolve(rows));
    out.on('error', reject);
    stream.on('error', reject);
    response.data.on('error', reject);
  });
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

// Exported for unit tests; not part of the public client surface.
export const __testables = {
  get normaliseReport()           { return normaliseReport; },
  get normaliseCatalog()          { return normaliseCatalog; },
  get normaliseSqp()              { return normaliseSqp; },
  get normaliseTopSearchTerms()   { return normaliseTopSearchTerms; },
  get normaliseTopSearchTermsRow(){ return normaliseTopSearchTermsRow; },
  get debugSamplePayload()        { return debugSamplePayload; },
  get TOP_LEVEL_ARRAY_KEY()       { return TOP_LEVEL_ARRAY_KEY; },
};

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
  // Verified shape (2026-05): { dataByAsin: [{ asin, impressionData, clickData,
  // cartAddData, purchaseData, startDate, endDate }, ...] }. Every metric is
  // wrapped under a *Data sub-object; medians/sales are { amount, currencyCode }
  // objects that may be null when the bucket is empty.
  const rows = payload?.dataByAsin ?? payload?.rows ?? payload?.data ?? [];
  return rows.map(r => {
    const impressions = num(r.impressionData?.impressionCount ?? r.impressions?.impressions ?? r.impressions);
    const clicks      = num(r.clickData?.clickCount         ?? r.clicks?.clicks           ?? r.clicks);
    const cartAdds    = num(r.cartAddData?.cartAddCount     ?? r.cartAdds?.cartAdds       ?? r.cartAdds);
    const purchases   = num(r.purchaseData?.purchaseCount   ?? r.purchases?.purchases     ?? r.purchases);
    const revenue     = num(r.purchaseData?.searchTrafficSales?.amount ?? r.purchases?.searchTrafficSales ?? r.revenue);
    // Amazon returns conversionRate as a 0-1 fraction; convert to percent for
    // the rest of the pipeline (existing CSV parser emits percent).
    const convRateFraction = r.purchaseData?.conversionRate;
    const convRate = convRateFraction != null
      ? Math.round(num(convRateFraction) * 10000) / 100
      : (clicks ? Math.round((purchases / clicks) * 10000) / 100 : 0);
    const price = num(
      r.impressionData?.impressionMedianPrice?.amount
      ?? r.purchaseData?.purchaseMedianPrice?.amount
      ?? r.clickData?.clickedMedianPrice?.amount
      ?? r.impressions?.priceMedian
    );
    return {
      asin:     str(r.asin ?? r.childAsin).toUpperCase(),
      // Title/category aren't returned by this BA report — leave empty so
      // downstream consumers can decide whether to enrich via Catalog Items.
      title:    str(r.asinTitle ?? r.productTitle ?? r.title),
      category: str(r.category ?? r.department),
      impressions, clicks, cartAdds, purchases,
      revenue,
      convRate,
      rating:   num(r.rating),
      price,
    };
  });
}

function normaliseTopSearchTerms(payload) {
  // Returns the raw rows (term, rank, top-3 ASINs) — full fan-out into
  // relevantKeywords/competitors/brandAppearances happens in the loader,
  // because that step needs orgId-specific brand ASINs as input.
  const rows = payload?.dataByDepartmentAndSearchTerm ?? payload?.rows ?? payload?.data ?? [];
  return rows.map(normaliseTopSearchTermsRow).filter(Boolean);
}

function normaliseTopSearchTermsRow(r) {
  if (!r) return null;
  return {
    rank:       num(r.searchFrequencyRank ?? r.rank),
    searchTerm: str(r.searchTerm ?? r.searchQuery),
    top3: [
      { asin: str(r.topClickedProduct1?.asin).toUpperCase(),  title: str(r.topClickedProduct1?.title), clickShare: num(r.topClickedProduct1?.clickShare),  convShare: num(r.topClickedProduct1?.conversionShare),  position: 1 },
      { asin: str(r.topClickedProduct2?.asin).toUpperCase(),  title: str(r.topClickedProduct2?.title), clickShare: num(r.topClickedProduct2?.clickShare),  convShare: num(r.topClickedProduct2?.conversionShare),  position: 2 },
      { asin: str(r.topClickedProduct3?.asin).toUpperCase(),  title: str(r.topClickedProduct3?.title), clickShare: num(r.topClickedProduct3?.clickShare),  convShare: num(r.topClickedProduct3?.conversionShare),  position: 3 },
    ].filter(e => e.asin && e.asin.length >= 10),
  };
}

// Maps logical type → per-row normaliser used by streamAndNormalise.
const STREAM_ROW_NORMALISERS = {
  TOP_SEARCH_TERMS: normaliseTopSearchTermsRow,
};
