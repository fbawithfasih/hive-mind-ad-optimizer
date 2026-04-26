import express from 'express';
import { classifySearchTerms } from '../../services/search-term-classifier.js';
import { isValidDateRange, isValidString } from '../utils/validation.js';
import { prisma } from '../../db/prisma.js';

const router = express.Router();

/**
 * Resolve profileId:
 *   1. Query param ?profileId=
 *   2. Org's default (or any) SellerProfile in DB
 *   3. AMAZON_DEFAULT_PROFILE_ID env var
 */
async function resolveProfileId(req) {
  if (req.query.profileId) return req.query.profileId;

  const profile = await prisma.sellerProfile.findFirst({
    where: { orgId: req.tenant.orgId },
    orderBy: { isDefault: 'desc' },
  });

  return profile?.profileId ?? process.env.AMAZON_DEFAULT_PROFILE_ID;
}

/**
 * GET /api/search-terms
 */
router.get('/', async (req, res) => {
  const profileId = await resolveProfileId(req);
  if (!profileId) return res.status(400).json({ error: 'profileId required — no profile configured for this organization.' });

  const endDate   = req.query.endDate   || new Date().toISOString().slice(0, 10);
  const startDate = req.query.startDate || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const { sku, asin } = req.query;

  const dateValidation = isValidDateRange(startDate, endDate);
  if (!dateValidation.valid) return res.status(400).json({ error: dateValidation.error });

  const diffDays = (new Date(endDate) - new Date(startDate)) / 86400000;
  if (diffDays > 31) {
    return res.status(400).json({ error: `Date range too large (${Math.round(diffDays)} days). Maximum is 31 days.` });
  }

  const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  if (startDate < sixtyDaysAgo) {
    return res.status(400).json({ error: `Start date ${startDate} is too far in the past. Amazon retains data for ~60 days.` });
  }

  if (sku) {
    const v = isValidString(sku, 'sku');
    if (!v.valid) return res.status(400).json({ error: v.error });
  }
  if (asin) {
    const v = isValidString(asin, 'asin');
    if (!v.valid) return res.status(400).json({ error: v.error });
  }

  try {
    let campaignIds = [];

    if (sku || asin) {
      console.log(`Looking up campaigns for ${sku ? `SKU: ${sku}` : `ASIN: ${asin}`}…`);
      try {
        campaignIds = await req.adsClient.getProductAdCampaigns(profileId, { sku, asin });
        if (campaignIds.length === 0) {
          console.log(`No campaigns found for ${sku || asin} — loading all search terms instead`);
        } else {
          console.log(`Fetching search terms for ${campaignIds.length} campaigns…`);
        }
      } catch (lookupErr) {
        console.warn(`Product ads lookup failed (${lookupErr.message}) — falling back to all search terms`);
        campaignIds = [];
      }
    }

    const raw      = await req.adsClient.getSearchTermReport(profileId, startDate, endDate, campaignIds);
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
