import express from 'express';
import { getProductByAsin, getProductBySku, updateListingBySku } from '../../services/amazon-sp-api.js';
import { optimizeListing } from '../../services/claude-mcp.js';

const router = express.Router();

/**
 * GET /api/listings/lookup?asin=&sku=
 *
 * Fetches current product listing data from Amazon SP-API.
 * Returns normalized { asin, sku, title, bullets[], description }.
 */
router.get('/lookup', async (req, res) => {
  const { asin, sku } = req.query;
  if (!asin && !sku) return res.status(400).json({ error: 'asin or sku query param required' });

  try {
    const product = asin
      ? await getProductByAsin(asin.trim().toUpperCase())
      : await getProductBySku(sku.trim());
    res.json(product);
  } catch (err) {
    console.error('Listings lookup error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/listings/optimize
 *
 * Body: { asin, title, bullets[], description, searchTerms[], model? }
 * Returns AI-optimized { title, bullets[], description }.
 */
router.post('/optimize', async (req, res) => {
  const { asin, title, bullets, description, searchTerms, uploadedKeywords, model } = req.body;

  if (!title && !bullets?.length && !description) {
    return res.status(400).json({ error: 'At least one of title, bullets, or description is required' });
  }

  try {
    const result = await optimizeListing(
      { asin, title, bullets, description, searchTerms, uploadedKeywords },
      model || 'gemini'
    );
    res.json(result);
  } catch (err) {
    console.error('Listing optimize error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/listings/update
 * Body: { sku, title, bullets[], description }
 * Pushes optimized content to the live Amazon listing via SP-API.
 */
router.put('/update', async (req, res) => {
  const { sku, title, bullets, description, productType } = req.body;
  if (!sku) return res.status(400).json({ error: 'sku is required to update a listing' });
  if (!productType) return res.status(400).json({ error: 'productType is required — re-fetch the listing first' });
  if (!title && !bullets?.length && !description)
    return res.status(400).json({ error: 'At least one of title, bullets, or description required' });

  try {
    const result = await updateListingBySku(sku, { title, bullets, description, productType });
    res.json(result); // { status: 'ACCEPTED', issues: [] }
  } catch (err) {
    console.error('Listing update error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
