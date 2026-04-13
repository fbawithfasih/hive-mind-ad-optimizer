import express from 'express';
import { getProductByAsin, getProductBySku, updateListingBySku, getProductTypeByAsin } from '../../services/amazon-sp-api.js';
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
 * Body: { sku, title, bullets[], description, productType? }
 * Pushes optimized content to the live Amazon listing via SP-API.
 * productType is auto-fetched from SP-API if not supplied by the client.
 */
router.put('/update', async (req, res) => {
  const { sku, title, bullets, description } = req.body;
  let { productType } = req.body;

  if (!sku) return res.status(400).json({ error: 'sku is required to update a listing' });
  if (!title && !bullets?.length && !description)
    return res.status(400).json({ error: 'At least one of title, bullets, or description required' });

  // Auto-fetch productType from SP-API if the client didn't supply it (or it was empty).
  // This covers cases where the listing was fetched before productType tracking was added,
  // or where SP-API didn't return it in the read response.
  if (!productType) {
    try {
      console.log(`productType not supplied — fetching from SP-API for SKU ${sku}…`);
      const current = await getProductBySku(sku);
      productType = current.productType;

      // If still no productType, try Catalog Items API with ASIN
      if (!productType && current.asin) {
        console.log(`Trying Catalog API for ASIN ${current.asin}…`);
        const catalogType = await getProductTypeByAsin(current.asin);
        if (catalogType) {
          productType = catalogType;
        }
      }

      if (productType) {
        console.log(`✅ Auto-resolved productType: ${productType}`);
      }
    } catch (fetchErr) {
      console.warn('⚠️ Could not auto-fetch productType:', fetchErr.message);
    }
  }

  if (!productType) {
    return res.status(400).json({ error: 'Could not determine productType for this SKU. Please re-fetch the listing and try again.' });
  }

  try {
    const result = await updateListingBySku(sku, { title, bullets, description, productType });
    res.json(result); // { status: 'ACCEPTED', issues: [] }
  } catch (err) {
    console.error('Listing update error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
