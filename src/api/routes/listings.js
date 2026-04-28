import express from 'express';
import { randomUUID } from 'crypto';
import { optimizeListing } from '../../services/claude-mcp.js';
import { prisma } from '../../db/prisma.js';
import { bulkListingQueue } from '../../services/queue.js';
import { trackUsage } from '../../services/razorpay.js';
import { requireRole } from '../middleware/requireRole.js';

const router = express.Router();

/**
 * GET /api/listings/lookup?asin=&sku=
 */
router.get('/lookup', async (req, res) => {
  const { asin, sku } = req.query;
  if (!asin && !sku) return res.status(400).json({ error: 'asin or sku query param required' });

  try {
    const product = asin
      ? await req.spClient.getProductByAsin(asin.trim().toUpperCase())
      : await req.spClient.getProductBySku(sku.trim());

    if (!product.productType && product.asin) {
      console.log(`[lookup] productType missing, attempting Catalog API lookup for ASIN: ${product.asin}`);
      try {
        const productType = await req.spClient.getProductTypeByAsin(product.asin);
        if (productType) {
          product.productType = productType;
          console.log(`[lookup] ✅ Resolved productType: ${productType}`);
        }
      } catch (catalogErr) {
        console.warn(`[lookup] Catalog API unavailable:`, catalogErr.message);
      }
    }

    const score = scoreListing(product);
    res.json({ ...product, ...score });
  } catch (err) {
    console.error('Listings lookup error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/listings/history
 *
 * Returns past ListingOptimization records for this org.
 */
router.get('/history', async (req, res) => {
  try {
    const { asin, sku, limit = '20' } = req.query;
    const where = { orgId: req.tenant.orgId };
    if (asin) where.asin = asin.trim().toUpperCase();
    if (sku)  where.sku  = sku.trim();

    const records = await prisma.listingOptimization.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(limit) || 20, 100),
    });

    res.json(records);
  } catch (err) {
    console.error('Listings history error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/listings/optimize — MEMBER or above
 *
 * Body: { asin, sku, title, bullets[], description, searchTerms[], model? }
 * Persists the optimization record to the DB.
 */
router.post('/optimize', requireRole('MEMBER'), async (req, res) => {
  const { asin, sku, title, bullets, description, searchTerms, uploadedKeywords, model } = req.body;

  if (!title && !bullets?.length && !description) {
    return res.status(400).json({ error: 'At least one of title, bullets, or description is required' });
  }

  try {
    const result = await optimizeListing(
      { asin, title, bullets, description, searchTerms, uploadedKeywords },
      model || 'gemini'
    );

    // Persist to DB if we have enough info to identify the listing
    if (asin || sku) {
      await prisma.listingOptimization.create({
        data: {
          orgId:               req.tenant.orgId,
          asin:                (asin ?? '').trim().toUpperCase(),
          sku:                 (sku ?? '').trim(),
          originalTitle:       title ?? '',
          optimizedTitle:      result.title ?? null,
          originalBullets:     bullets ?? [],
          optimizedBullets:    result.bullets ?? [],
          originalDescription: description ?? '',
          optimizedDescription: result.description ?? null,
          keywords:            searchTerms ?? uploadedKeywords ?? [],
          aiModel:             model || 'gemini',
          status:              'COMPLETED',
        },
      }).catch((dbErr) => {
        // Don't fail the request if DB write fails — log and continue
        console.error('Failed to persist listing optimization:', dbErr.message);
      });
    }

    trackUsage(req.tenant.orgId, 'listingsOptimized').catch(() => {});
    res.json(result);
  } catch (err) {
    console.error('Listing optimize error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/listings/update — MEMBER or above
 *
 * Body: { sku, title, bullets[], description, productType? }
 * Pushes to Amazon SP-API and marks the matching optimization record as PUBLISHED.
 */
router.put('/update', requireRole('MEMBER'), async (req, res) => {
  const { sku, title, bullets, description } = req.body;
  let { productType } = req.body;

  if (!sku) return res.status(400).json({ error: 'sku is required to update a listing' });
  if (!title && !bullets?.length && !description)
    return res.status(400).json({ error: 'At least one of title, bullets, or description required' });

  let autoFetchError = null;
  if (!productType) {
    console.log(`[productType lookup] Starting auto-fetch for SKU: ${sku}`);
    try {
      console.log(`[productType lookup] Attempting Listings API call…`);
      const current = await req.spClient.getProductBySku(sku);
      console.log(`[productType lookup] Listings API response:`, {
        sku: current.sku,
        asin: current.asin,
        productType: current.productType,
      });

      productType = current.productType;

      if (!productType && current.asin) {
        console.log(`[productType lookup] Trying Catalog API for ASIN: ${current.asin}…`);
        const catalogType = await req.spClient.getProductTypeByAsin(current.asin);
        console.log(`[productType lookup] Catalog API returned:`, catalogType);
        if (catalogType) productType = catalogType;
        else console.warn(`[productType lookup] Catalog API returned null/undefined`);
      } else if (!current.asin) {
        console.warn(`[productType lookup] No ASIN in Listings response, can't try Catalog API`);
      }

      if (productType) console.log(`✅ [productType lookup] Successfully resolved: ${productType}`);
      else console.error(`❌ [productType lookup] Failed to resolve productType from both APIs`);
    } catch (fetchErr) {
      autoFetchError = fetchErr.message;
      console.error('❌ [productType lookup] Error during auto-fetch:', {
        message: fetchErr.message,
        status: fetchErr.response?.status,
        data: fetchErr.response?.data,
      });
    }
  }

  if (!productType) {
    const detail = autoFetchError ? ` (${autoFetchError})` : '';
    const errorMsg =
      `Could not determine productType for this SKU${detail}. ` +
      'Ensure: (1) SKU exists in your SP-API account, (2) You have "Product Listing" role approved, ' +
      '(3) For Catalog API fallback, also need "Catalog Items" role. ' +
      'Check server logs for details.';
    console.error(`[listings.update] Returning error:`, errorMsg);
    return res.status(400).json({ error: errorMsg });
  }

  try {
    const result = await req.spClient.updateListingBySku(sku, { title, bullets, description, productType });

    // Mark the most recent optimization for this SKU as PUBLISHED
    if (result?.status === 'ACCEPTED') {
      await prisma.listingOptimization.updateMany({
        where: {
          orgId:  req.tenant.orgId,
          sku:    sku.trim(),
          status: 'COMPLETED',
        },
        data: {
          status:      'PUBLISHED',
          publishedAt: new Date(),
        },
      }).catch((dbErr) => {
        console.error('Failed to mark optimization as published:', dbErr.message);
      });
    }

    res.json(result);
  } catch (err) {
    console.error('Listing update error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/listings/bulk-optimize — MEMBER or above
 *
 * Body: { items: [{ asin, sku, title, bullets, description, searchTerms, uploadedKeywords }], model? }
 * Enqueues one BullMQ job per item; returns { batchId, total } immediately.
 */
router.post('/bulk-optimize', requireRole('MEMBER'), async (req, res) => {
  const { items, model = 'gemini' } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items array is required and must not be empty' });
  }
  if (items.length > 50) {
    return res.status(400).json({ error: 'Maximum 50 items per bulk batch' });
  }

  const batchRef = randomUUID();

  // Create the batch record
  const batch = await prisma.bulkListingBatch.create({
    data: {
      orgId:    req.tenant.orgId,
      batchRef,
      total:    items.length,
      model,
      status:   'PROCESSING',
    },
  }).catch((err) => {
    console.error('Failed to create BulkListingBatch:', err.message);
    throw err;
  });

  // Enqueue one BullMQ job per item
  const jobs = items.map((item, index) => ({
    name: `item-${index}`,
    data: {
      dbBatchId: batch.id,
      batchRef,
      orgId:     req.tenant.orgId,
      model,
      item,
    },
    opts: { jobId: `${batchRef}:${index}` },
  }));

  await bulkListingQueue.addBulk(jobs);

  trackUsage(req.tenant.orgId, 'bulkOperations').catch(() => {});
  console.log(`[bulk-optimize] Batch ${batchRef} enqueued — ${items.length} items for org ${req.tenant.orgId}`);
  res.json({ batchId: batchRef, total: items.length });
});

/**
 * GET /api/listings/bulk-status/:batchId
 *
 * Returns overall progress + per-item results for a bulk batch.
 */
router.get('/bulk-status/:batchId', async (req, res) => {
  const { batchId } = req.params;

  const batch = await prisma.bulkListingBatch.findFirst({
    where: { batchRef: batchId, orgId: req.tenant.orgId },
  });

  if (!batch) return res.status(404).json({ error: 'Batch not found' });

  const items = await prisma.listingOptimization.findMany({
    where:   { batchId: batch.id },
    orderBy: { createdAt: 'asc' },
    select: {
      asin:                true,
      sku:                 true,
      optimizedTitle:      true,
      optimizedBullets:    true,
      optimizedDescription: true,
      status:              true,
      errorMessage:        true,
      createdAt:           true,
    },
  });

  res.json({
    batchId:   batch.batchRef,
    status:    batch.status,
    total:     batch.total,
    completed: batch.completed,
    failed:    batch.failed,
    pending:   batch.total - batch.completed - batch.failed,
    items,
  });
});

/**
 * GET /api/listings/health?asin=&sku=
 *
 * Fetches the current listing from SP-API and returns a health score (0–100)
 * plus per-dimension scores with actionable feedback.
 */
router.get('/health', async (req, res) => {
  const { asin, sku } = req.query;
  if (!asin && !sku) return res.status(400).json({ error: 'asin or sku query param required' });

  try {
    const product = asin
      ? await req.spClient.getProductByAsin(asin.trim().toUpperCase())
      : await req.spClient.getProductBySku(sku.trim());

    const score = scoreListing(product);
    res.json({ asin: product.asin, sku: product.sku, ...score });
  } catch (err) {
    console.error('Listing health error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Listing health scoring — pure computation, no DB or AI calls
// ─────────────────────────────────────────────────────────────────────────────

function scoreListing(product) {
  const title       = product.title       ?? '';
  const description = product.description ?? '';
  const bullets     = Array.isArray(product.bullets) ? product.bullets : [];

  const dimensions = [];

  // Title length (ideal: 100–200 chars)
  const titleLen = title.length;
  let titleScore;
  let titleFeedback;
  if (titleLen === 0)             { titleScore = 0;   titleFeedback = 'Title is missing'; }
  else if (titleLen < 40)        { titleScore = 30;  titleFeedback = `Title too short (${titleLen} chars — aim for 100+)`; }
  else if (titleLen < 80)        { titleScore = 60;  titleFeedback = `Title could be longer (${titleLen} chars — aim for 100–200)`; }
  else if (titleLen <= 200)      { titleScore = 100; titleFeedback = `Title length is good (${titleLen} chars)`; }
  else                           { titleScore = 70;  titleFeedback = `Title may be truncated by Amazon (${titleLen} chars — keep under 200)`; }
  dimensions.push({ name: 'Title Length', score: titleScore, feedback: titleFeedback, weight: 25 });

  // Bullets (ideal: 5, each 100–255 chars)
  const bulletCount = bullets.length;
  let bulletScore;
  let bulletFeedback;
  if (bulletCount === 0)      { bulletScore = 0;   bulletFeedback = 'No bullet points — add 5 benefit-focused bullets'; }
  else if (bulletCount < 3)   { bulletScore = 40;  bulletFeedback = `Only ${bulletCount} bullet(s) — add ${5 - bulletCount} more`; }
  else if (bulletCount < 5)   { bulletScore = 75;  bulletFeedback = `${bulletCount} bullets — add ${5 - bulletCount} more for maximum coverage`; }
  else                        { bulletScore = 100; bulletFeedback = `${bulletCount} bullet points — good`; }

  const shortBullets = bullets.filter(b => b.length < 80).length;
  if (shortBullets > 0 && bulletCount > 0) {
    bulletScore = Math.max(bulletScore - 15, 0);
    bulletFeedback += `; ${shortBullets} bullet(s) are too short — expand to 100+ chars`;
  }
  dimensions.push({ name: 'Bullet Points', score: bulletScore, feedback: bulletFeedback, weight: 25 });

  // Description (ideal: 400–1000 chars)
  const descLen = description.length;
  let descScore;
  let descFeedback;
  if (descLen === 0)              { descScore = 0;   descFeedback = 'Description is missing'; }
  else if (descLen < 200)         { descScore = 40;  descFeedback = `Description too short (${descLen} chars — aim for 400–1000)`; }
  else if (descLen < 400)         { descScore = 70;  descFeedback = `Description could be expanded (${descLen} chars — aim for 400+)`; }
  else if (descLen <= 1000)       { descScore = 100; descFeedback = `Description length is good (${descLen} chars)`; }
  else                            { descScore = 80;  descFeedback = `Description is long (${descLen} chars) — A+ content may be better`; }
  dimensions.push({ name: 'Description', score: descScore, feedback: descFeedback, weight: 20 });

  // Keyword presence in title (heuristic: does title contain 3+ distinct words of 4+ chars?)
  const titleWords = title.toLowerCase().match(/\b[a-z]{4,}\b/g) ?? [];
  const uniqueTitleKeywords = new Set(titleWords).size;
  let kwScore;
  let kwFeedback;
  if (uniqueTitleKeywords >= 8)      { kwScore = 100; kwFeedback = `Good keyword density in title (${uniqueTitleKeywords} meaningful words)`; }
  else if (uniqueTitleKeywords >= 5) { kwScore = 75;  kwFeedback = `Moderate keyword density (${uniqueTitleKeywords} meaningful words in title)`; }
  else if (uniqueTitleKeywords >= 2) { kwScore = 50;  kwFeedback = `Low keyword density — add more searchable terms to title`; }
  else                               { kwScore = 20;  kwFeedback = 'Title lacks searchable keywords'; }
  dimensions.push({ name: 'Keyword Density', score: kwScore, feedback: kwFeedback, weight: 15 });

  // Images (if exposed by SP-API)
  const imageCount = Array.isArray(product.images) ? product.images.length : (product.mainImage ? 1 : 0);
  let imgScore;
  let imgFeedback;
  if (imageCount === 0)        { imgScore = 0;   imgFeedback = 'No images detected — add at least 6 high-quality images'; }
  else if (imageCount < 4)     { imgScore = 50;  imgFeedback = `${imageCount} image(s) — add ${7 - imageCount} more (aim for 7)`; }
  else if (imageCount < 7)     { imgScore = 80;  imgFeedback = `${imageCount} images — consider adding ${7 - imageCount} more`; }
  else                         { imgScore = 100; imgFeedback = `${imageCount} images — excellent`; }
  dimensions.push({ name: 'Images', score: imgScore, feedback: imgFeedback, weight: 15 });

  // Weighted total
  const totalWeight  = dimensions.reduce((s, d) => s + d.weight, 0);
  const weightedSum  = dimensions.reduce((s, d) => s + d.score * d.weight, 0);
  const overallScore = Math.round(weightedSum / totalWeight);

  const grade = overallScore >= 85 ? 'A'
              : overallScore >= 70 ? 'B'
              : overallScore >= 55 ? 'C'
              : overallScore >= 40 ? 'D'
              :                      'F';

  return { score: overallScore, grade, dimensions };
}

export default router;
