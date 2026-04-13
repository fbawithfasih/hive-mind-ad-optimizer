import express from 'express';
import { getSearchTermReport, getProductAdCampaigns } from '../../services/amazon-ads.js';
import { classifySearchTerms } from '../../services/search-term-classifier.js';
import { isValidDateRange, isValidString } from '../utils/validation.js';

const router = express.Router();

/**
 * GET /api/search-terms
 *
 * Query params:
 *   profileId  — Ads profile ID (falls back to AMAZON_DEFAULT_PROFILE_ID)
 *   startDate  — YYYY-MM-DD (default: 30 days ago)
 *   endDate    — YYYY-MM-DD (default: today)
 *   sku        — If provided, auto-lookup campaigns advertising this SKU
 *   asin       — If provided, auto-lookup campaigns advertising this ASIN
 *
 * When sku/asin is given, returns only search terms from campaigns that
 * advertise that specific product.
 */
router.get('/', async (req, res) => {
  const profileId = req.query.profileId || process.env.AMAZON_DEFAULT_PROFILE_ID;
  if (!profileId) return res.status(400).json({ error: 'profileId required' });

  const endDate   = req.query.endDate   || new Date().toISOString().slice(0, 10);
  const startDate = req.query.startDate || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const { sku, asin } = req.query;

  // Validate date format and range
  const dateValidation = isValidDateRange(startDate, endDate);
  if (!dateValidation.valid) {
    return res.status(400).json({ error: dateValidation.error });
  }

  // Validate date range size
  const diffDays = (new Date(endDate) - new Date(startDate)) / 86400000;
  if (diffDays > 31) {
    return res.status(400).json({ error: `Date range too large (${Math.round(diffDays)} days). Maximum is 31 days.` });
  }

  // Validate date is not too old
  const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  if (startDate < sixtyDaysAgo) {
    return res.status(400).json({ error: `Start date ${startDate} is too far in the past. Amazon retains data for ~60 days.` });
  }

  // Validate sku and asin if provided
  if (sku) {
    const skuValidation = isValidString(sku, 'sku');
    if (!skuValidation.valid) return res.status(400).json({ error: skuValidation.error });
  }
  if (asin) {
    const asinValidation = isValidString(asin, 'asin');
    if (!asinValidation.valid) return res.status(400).json({ error: asinValidation.error });
  }

  try {
    let campaignIds = [];

    // If sku or asin provided, try to find which campaigns advertise this product
    if (sku || asin) {
      console.log(`Looking up campaigns for ${sku ? `SKU: ${sku}` : `ASIN: ${asin}`}…`);
      try {
        campaignIds = await getProductAdCampaigns(profileId, { sku, asin });
        if (campaignIds.length === 0) {
          console.log(`No campaigns found for ${sku || asin} — loading all search terms instead`);
        } else {
          console.log(`Fetching search terms for ${campaignIds.length} campaigns…`);
        }
      } catch (lookupErr) {
        // Product Ads API not available for this profile — fall back to all campaigns
        console.warn(`Product ads lookup failed (${lookupErr.message}) — falling back to all search terms`);
        campaignIds = [];
      }
    }

    const raw      = await getSearchTermReport(profileId, startDate, endDate, campaignIds);
    const enriched = classifySearchTerms(raw);
    res.json({
      startDate,
      endDate,
      searchTerms: enriched,
      ...(campaignIds.length > 0 ? { filteredByCampaigns: campaignIds.length, product: sku || asin } : {}),
    });
  } catch (err) {
    console.error('Search terms route error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
