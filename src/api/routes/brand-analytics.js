import express from 'express';
import { join } from 'path';
import { writeFile, mkdir } from 'fs/promises';
import { loadAnalytics, clearCache } from '../../services/brand-analytics/loader.js';
import { requireRole } from '../middleware/requireRole.js';
import { prisma } from '../../db/prisma.js';
import { brandAnalyticsFetchQueue } from '../../services/queue.js';
import { cadenceForTier, previousClosedPeriod } from '../../services/brand-analytics-scheduler.js';
import { listSupportedReportTypes } from '../../services/amazon-brand-analytics-api.js';
import {
  getCustomerRetention,
  getMarketBasket,
  getDemographics,
  getItemComparison,
} from '../../services/brand-analytics/insights.js';

const router = express.Router();

const BA_DATA_ROOT = join(process.cwd(), 'data', 'brand-analytics');

// ─────────────────────────────────────────────────────────────────────────────
// Route handlers
// ─────────────────────────────────────────────────────────────────────────────

function getBrand(req) {
  return (req.query.brand || req.tenant?.org?.brandName || 'Unknown').trim();
}

/**
 * GET /api/brand-analytics/summary
 * Full brand performance overview.
 */
router.get('/summary', async (req, res) => {
  try {
    const d = await loadAnalytics(req.tenant.orgId, getBrand(req));
    res.json({
      brandName:            d.brandName,
      brandASINs:           d.brandASINs,
      loadedAt:             d.loadedAt,
      relevantKeywordCount: d.relevantKeywordCount,
      comparison:           d.comparison ?? null,
      ...d.summary,
    });
  } catch (err) {
    const status = err.status ?? 500;
    console.error('[brand-analytics /summary]', err.message);
    res.status(status).json({ error: err.message });
  }
});

/**
 * GET /api/brand-analytics/competitors?limit=30
 * Top competitor ASINs ranked by keyword appearances and click share.
 */
router.get('/competitors', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const d     = await loadAnalytics(req.tenant.orgId, getBrand(req));
    res.json({
      marketConcentration: d.intelligence.marketConcentration,
      totalCompetitors:    d.intelligence.totalCompetitors,
      competitors:         d.intelligence.competitors.slice(0, limit),
    });
  } catch (err) {
    const status = err.status ?? 500;
    console.error('[brand-analytics /competitors]', err.message);
    res.status(status).json({ error: err.message });
  }
});

/**
 * GET /api/brand-analytics/opportunities?limit=50&minVolume=100&maxPurchaseShare=5
 * High-volume keywords where the brand is weak or invisible.
 */
router.get('/opportunities', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const d     = await loadAnalytics(req.tenant.orgId, getBrand(req));
    res.json({
      total:         d.opportunities.length,
      opportunities: d.opportunities.slice(0, limit),
    });
  } catch (err) {
    const status = err.status ?? 500;
    console.error('[brand-analytics /opportunities]', err.message);
    res.status(status).json({ error: err.message });
  }
});

/**
 * GET /api/brand-analytics/dominant-keywords?limit=50&minPurchaseShare=10
 * Keywords the brand already wins — defend with strong bids.
 */
router.get('/dominant-keywords', async (req, res) => {
  try {
    const limit            = Math.min(Number(req.query.limit) || 50, 200);
    const minPurchaseShare = Number(req.query.minPurchaseShare) || 10;
    const d                = await loadAnalytics(req.tenant.orgId, getBrand(req));

    const filtered = d.dominant.filter(k => k.purchaseShare >= minPurchaseShare);
    res.json({ total: filtered.length, keywords: filtered.slice(0, limit) });
  } catch (err) {
    const status = err.status ?? 500;
    console.error('[brand-analytics /dominant-keywords]', err.message);
    res.status(status).json({ error: err.message });
  }
});

/**
 * GET /api/brand-analytics/weak-keywords?limit=50
 * Keywords with impressions but low conversion — listing / bid quality issues.
 */
router.get('/weak-keywords', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const d     = await loadAnalytics(req.tenant.orgId, getBrand(req));
    res.json({ total: d.weak.length, keywords: d.weak.slice(0, limit) });
  } catch (err) {
    const status = err.status ?? 500;
    console.error('[brand-analytics /weak-keywords]', err.message);
    res.status(status).json({ error: err.message });
  }
});

/**
 * GET /api/brand-analytics/market-share/:asin
 * Visibility and position metrics for a specific ASIN in the relevant keyword set.
 */
router.get('/market-share/:asin', async (req, res) => {
  try {
    const asin = req.params.asin.toUpperCase();
    const d    = await loadAnalytics(req.tenant.orgId, getBrand(req));

    // Re-stream is expensive; for market-share we use the cached relevantKeywords
    // which were stored on the competitorMap entries' keywords arrays.  Instead,
    // we reconstruct the minimal keyword list from the competitors map + brand appearances.
    // For a full market-share calculation we need relevantKeywords — store them in cache.
    res.json({
      asin,
      note: 'Market share data derived from cached relevant keywords.',
      brandAppearances: d.brandAppearances.filter(a => a.term),
      // Competitors entry for this ASIN if it's a competitor
      competitorEntry: d.intelligence.competitors.find(c => c.asin === asin) ?? null,
    });
  } catch (err) {
    const status = err.status ?? 500;
    console.error('[brand-analytics /market-share]', err.message);
    res.status(status).json({ error: err.message });
  }
});

// ─── Insight surfaces backed by the new Brand Analytics report types ─────────

/**
 * GET /api/brand-analytics/customer-retention?minRepeatRate=
 * Repeat-purchase view: per-ASIN retention rate, subscribe-and-save candidates.
 */
router.get('/customer-retention', async (req, res) => {
  try {
    const minRepeatRate = req.query.minRepeatRate ? Number(req.query.minRepeatRate) : 0;
    const data = await getCustomerRetention(req.tenant.orgId, { minRepeatRate });
    res.json(data);
  } catch (err) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

/**
 * GET /api/brand-analytics/cross-sell?asin=&limit=
 * Market-basket pairs ranked by combination index. Omit `asin` for the full set.
 */
router.get('/cross-sell', async (req, res) => {
  try {
    const data = await getMarketBasket(req.tenant.orgId, {
      anchorAsin: req.query.asin ?? null,
      limit:      Math.min(Number(req.query.limit) || 50, 200),
    });
    res.json(data);
  } catch (err) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

/**
 * GET /api/brand-analytics/demographics
 * Age / gender / income / education / marital-status share of purchases.
 */
router.get('/demographics', async (req, res) => {
  try {
    const data = await getDemographics(req.tenant.orgId);
    res.json(data);
  } catch (err) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

/**
 * GET /api/brand-analytics/item-comparison?asin=
 * Alternate ASINs viewed-instead and bought-instead — defensive ad targeting.
 */
router.get('/item-comparison', async (req, res) => {
  try {
    const data = await getItemComparison(req.tenant.orgId, req.query.asin);
    res.json(data);
  } catch (err) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

/**
 * GET /api/brand-analytics/reports?type=&from=&to=
 * List Brand Analytics reports stored for this org. Filterable by report type
 * and period date range. Returns metadata only (no rawData payload) for speed.
 */
router.get('/reports', async (req, res) => {
  try {
    const { type, from, to } = req.query;
    const where = { orgId: req.tenant.orgId };
    if (type) where.reportType = type;
    if (from || to) {
      where.periodEnd = {};
      if (from) where.periodEnd.gte = new Date(from);
      if (to)   where.periodEnd.lte = new Date(to);
    }

    const rows = await prisma.brandAnalyticsReport.findMany({
      where,
      orderBy: [{ reportType: 'asc' }, { periodEnd: 'desc' }],
      select: {
        id: true, reportType: true, reportingPeriod: true,
        periodStart: true, periodEnd: true, status: true,
        amazonReportId: true, error: true, fetchedAt: true,
      },
    });
    res.json({ total: rows.length, reports: rows });
  } catch (err) {
    console.error('[brand-analytics /reports]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/brand-analytics/reports/:id
 * Fetch the parsed rawData blob for a single report.
 */
router.get('/reports/:id', async (req, res) => {
  try {
    const row = await prisma.brandAnalyticsReport.findFirst({
      where: { id: req.params.id, orgId: req.tenant.orgId },
    });
    if (!row) return res.status(404).json({ error: 'Report not found' });
    res.json(row);
  } catch (err) {
    console.error('[brand-analytics /reports/:id]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/brand-analytics/reports/refresh — ADMIN only
 * Manually enqueue a fetch for a specific report type. Body:
 *   { reportType: string, reportingPeriod?: 'WEEKLY'|'MONTHLY'|'QUARTERLY' }
 *
 * If reportingPeriod is omitted we use the cadence appropriate to the org's tier.
 * Subject to tier gating: BASIC tier may only request the 3 core reports.
 */
router.post('/reports/refresh', requireRole('ADMIN'), express.json(), async (req, res) => {
  try {
    const { reportType, reportingPeriod, debug } = req.body ?? {};
    if (!reportType || !listSupportedReportTypes().includes(reportType)) {
      return res.status(400).json({
        error: `reportType must be one of: ${listSupportedReportTypes().join(', ')}`,
      });
    }

    const org = await prisma.organization.findUnique({
      where: { id: req.tenant.orgId },
      select: { tier: true },
    });
    const cad = cadenceForTier(org?.tier ?? 'BASIC');
    if (!cad.reports.includes(reportType)) {
      return res.status(403).json({
        error: `Your subscription tier does not include the "${reportType}" report. Upgrade to PRO to access it.`,
      });
    }

    const period = reportingPeriod ?? cad.reportingPeriod;
    const { periodStart, periodEnd } = previousClosedPeriod(period);
    const jobId = `ba-${req.tenant.orgId}-${reportType}-${periodStart.toISOString().slice(0,10)}-${periodEnd.toISOString().slice(0,10)}-manual`;

    await brandAnalyticsFetchQueue.add(
      'fetch',
      {
        orgId:           req.tenant.orgId,
        reportType,
        reportingPeriod: period,
        periodStart:     periodStart.toISOString(),
        periodEnd:       periodEnd.toISOString(),
        debug:           !!debug,
      },
      { jobId: debug ? `${jobId}-debug-${Date.now()}` : jobId },
    );

    res.json({
      message:     'Fetch enqueued.',
      reportType,
      reportingPeriod: period,
      periodStart, periodEnd,
      jobId,
    });
  } catch (err) {
    console.error('[brand-analytics /reports/refresh]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/brand-analytics/upload — MEMBER or above
 *
 * Accepts a raw CSV body with a Content-Type of text/csv.
 * The report type is specified via ?type=sqp|catalog|tst
 *
 * Example:
 *   curl -X POST "/api/brand-analytics/upload?type=sqp" \
 *        -H "Content-Type: text/csv" \
 *        --data-binary @US_Search_Query_Performance_Brand_View_Q1.csv
 */
router.post('/upload', requireRole('MEMBER'), express.raw({ type: 'text/csv', limit: '600mb' }), async (req, res) => {
  const { type } = req.query;
  const validTypes = { sqp: 'US_Search_Query_Performance_Brand_View', catalog: 'US_Search_Catalog_Performance', tst: 'Top_Search_Terms' };

  if (!validTypes[type]) {
    return res.status(400).json({ error: `?type must be one of: ${Object.keys(validTypes).join(', ')}` });
  }
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    return res.status(400).json({ error: 'Request body must be a CSV file sent as text/csv' });
  }

  try {
    const orgDir  = join(BA_DATA_ROOT, req.tenant.orgId);
    await mkdir(orgDir, { recursive: true });

    const filename = `${validTypes[type]}_${new Date().toISOString().slice(0, 10)}.csv`;
    const filePath = join(orgDir, filename);
    await writeFile(filePath, req.body);

    clearCache(req.tenant.orgId);
    console.log(`[brand-analytics] Uploaded ${type} for org ${req.tenant.orgId} → ${filePath} (${req.body.length.toLocaleString()} bytes)`);

    res.json({ message: `${type.toUpperCase()} file uploaded successfully. Cache cleared.`, filename, bytes: req.body.length });
  } catch (err) {
    console.error('[brand-analytics /upload]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/brand-analytics/refresh — ADMIN only
 * Force-refresh the in-memory cache for this org (re-parse all CSV files).
 */
router.post('/refresh', requireRole('ADMIN'), async (req, res) => {
  try {
    clearCache(req.tenant.orgId);
    const d = await loadAnalytics(req.tenant.orgId, getBrand(req), true);
    res.json({
      message:              'Cache refreshed.',
      brandName:            d.brandName,
      loadedAt:             d.loadedAt,
      relevantKeywordCount: d.relevantKeywordCount,
      competitorCount:      d.intelligence.competitors.length,
    });
  } catch (err) {
    const status = err.status ?? 500;
    console.error('[brand-analytics /refresh]', err.message);
    res.status(status).json({ error: err.message });
  }
});

export default router;
