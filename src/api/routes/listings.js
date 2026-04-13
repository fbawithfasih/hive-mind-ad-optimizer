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

    // If productType is missing, try to fetch it via Catalog API using the ASIN
    if (!product.productType && product.asin) {
      console.log(`[lookup] productType missing, attempting Catalog API lookup for ASIN: ${product.asin}`);
      try {
        const productType = await getProductTypeByAsin(product.asin);
        if (productType) {
          product.productType = productType;
          console.log(`[lookup] ✅ Resolved productType: ${productType}`);
        }
      } catch (catalogErr) {
        console.warn(`[lookup] Catalog API unavailable:`, catalogErr.message);
        // Continue anyway - productType will be null but user can still optimize
      }
    }

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
    console.log(`[productType lookup] Starting auto-fetch for SKU: ${sku}`);
    try {
      console.log(`[productType lookup] Attempting Listings API call…`);
      const current = await getProductBySku(sku);
      console.log(`[productType lookup] Listings API response:`, {
        sku: current.sku,
        asin: current.asin,
        productType: current.productType,
      });

      productType = current.productType;

      // If still no productType, try Catalog Items API with ASIN
      if (!productType && current.asin) {
        console.log(`[productType lookup] Listings API didn't return productType, trying Catalog API for ASIN: ${current.asin}…`);
        const catalogType = await getProductTypeByAsin(current.asin);
        console.log(`[productType lookup] Catalog API returned:`, catalogType);
        if (catalogType) {
          productType = catalogType;
        } else {
          console.warn(`[productType lookup] Catalog API returned null/undefined`);
        }
      } else if (!current.asin) {
        console.warn(`[productType lookup] No ASIN in Listings response, can't try Catalog API`);
      }

      if (productType) {
        console.log(`✅ [productType lookup] Successfully resolved: ${productType}`);
      } else {
        console.error(`❌ [productType lookup] Failed to resolve productType from both APIs`);
      }
    } catch (fetchErr) {
      console.error('❌ [productType lookup] Error during auto-fetch:', {
        message: fetchErr.message,
        status: fetchErr.response?.status,
        data: fetchErr.response?.data,
      });
    }
  }

  if (!productType) {
    const errorMsg = 'Could not determine productType for this SKU. '
      + 'Ensure: (1) SKU exists in your SP-API account, (2) You have "Product Listing" role approved, '
      + '(3) For Catalog API fallback, also need "Catalog Items" role. '
      + 'Check server logs for details.';
    console.error(`[listings.update] Returning error:`, errorMsg);
    return res.status(400).json({ error: errorMsg });
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
