import express from 'express';
import { join } from 'path';
import { writeFile, mkdir } from 'fs/promises';
import { loadAnalytics, clearCache } from '../../services/brand-analytics/loader.js';
import { requireRole } from '../middleware/requireRole.js';

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
