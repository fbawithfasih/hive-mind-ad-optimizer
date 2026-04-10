import express from 'express';
import { getProductByAsin, getProductBySku } from '../../services/amazon-sp-api.js';
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
  const { asin, title, bullets, description, searchTerms, model } = req.body;

  if (!title && !bullets?.length && !description) {
    return res.status(400).json({ error: 'At least one of title, bullets, or description is required' });
  }

  try {
    const result = await optimizeListing(
      { asin, title, bullets, description, searchTerms },
      model || 'gemini'
    );
    res.json(result);
  } catch (err) {
    console.error('Listing optimize error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
