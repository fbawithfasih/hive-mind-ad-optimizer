import express from 'express';
import { classifySearchTerms } from '../../services/search-term-classifier.js';
import { isProfileAccessDenied, pruneInaccessibleProfile } from '../utils/pruneProfile.js';
import { loadAnalytics } from '../../services/brand-analytics/loader.js';

const router = express.Router();

const norm = (s) => String(s ?? '').trim().toLowerCase();

/**
 * GET /api/keywords/recommendations
 *
 * ASIN/SKU-driven keyword intelligence. When asin or sku is provided, the
 * search-term report is scoped to campaigns that actually run that product.
 * The route also pulls Brand Analytics (Search Query Performance) when the
 * org has brand data uploaded, so recommendations cover keywords the org
 * isn't yet bidding on.
 *
 * Query params:
 *   profileId   — optional, falls back to org default
 *   asin / sku  — optional product scope; when provided, search-term rows
 *                 outside the product's campaigns are filtered out
 *   startDate   — YYYY-MM-DD (default: 30 days ago)
 *   endDate     — YYYY-MM-DD (default: today)
 *   minClicks   — filter out terms with fewer clicks (default: 3)
 *
 * Response groups recommendations by where the user should apply them:
 *   recommendations.forListing  — fold into title / bullets / description /
 *                                 generic keyword on the listing
 *   recommendations.forCampaigns
 *     .scaleUp      — already converting in ads, increase bids
 *     .addExact     — auto/broad winners worth promoting to exact match
 *     .addNegative  — wasted spend, block as negatives
 *     .watch        — not enough data yet
 *     .newKeywords  — keywords surfaced by Brand Analytics that aren't yet
 *                     in the product's campaigns
 */
router.get('/recommendations', async (req, res) => {
  const {
    profileId: qProfileId,
    asin,
    sku,
    startDate,
    endDate,
    minClicks = '3',
  } = req.query;

  const profileId = qProfileId
    || req.tenant?.defaultProfileId
    || (req.hasOwnAdsCreds ? null : process.env.AMAZON_DEFAULT_PROFILE_ID);
  if (!profileId) {
    return res.status(400).json({ error: 'profileId is required — no profile configured for this organization.' });
  }

  const end   = endDate   || new Date().toISOString().slice(0, 10);
  const start = startDate || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const threshold = Math.max(0, Number(minClicks) || 3);

  // 1. Resolve product → campaigns (if scoped)
  let productCampaignIds = null;
  if (asin || sku) {
    try {
      productCampaignIds = await req.adsClient.getProductAdCampaigns(profileId, { asin, sku });
    } catch (err) {
      console.warn(`[keywords/recommendations] Product-ad lookup failed (${err.message}) — falling back to all campaigns for this profile`);
      productCampaignIds = null; // fall through; treat as unscoped
    }
  }

  // 2. Search term report (windowed + merged inside the helper)
  let rawTerms;
  try {
    rawTerms = await req.adsClient.getSearchTermReport(profileId, start, end);
  } catch (err) {
    console.error('[keywords/recommendations] Search term fetch failed:', err.message);
    if (isProfileAccessDenied(err)) {
      await pruneInaccessibleProfile(req.tenant?.orgId, profileId, req.adsClient);
      return res.status(409).json({
        error: 'This Amazon profile is not accessible with your current Ads connection.',
        code: 'PROFILE_ACCESS_DENIED',
      });
    }
    return res.status(500).json({ error: `Failed to fetch search term data: ${err.message}` });
  }

  // 3. Scope to product's campaigns when we have them
  let scopedTerms = rawTerms;
  if (Array.isArray(productCampaignIds) && productCampaignIds.length > 0) {
    const idSet = new Set(productCampaignIds.map(String));
    scopedTerms = rawTerms.filter(t => idSet.has(String(t.campaignId)));
  }

  const classified = classifySearchTerms(scopedTerms)
    .filter(t => (t.clicks ?? 0) >= threshold);

  const scaleUp  = classified.filter(t => t.recommendation === 'SCALE_UP')
    .sort((a, b) => (b.sales ?? 0) - (a.sales ?? 0));
  const addExact = classified.filter(t => t.recommendation === 'ADD_EXACT')
    .sort((a, b) => (b.purchases ?? 0) - (a.purchases ?? 0));
  const addNeg   = classified.filter(t => t.recommendation === 'ADD_NEGATIVE')
    .sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0));
  const watch    = classified.filter(t => t.recommendation === 'WATCH')
    .sort((a, b) => (b.clicks ?? 0) - (a.clicks ?? 0));

  // 4. Brand Analytics (best-effort — silently skipped when no SQP data uploaded)
  const brandName = req.tenant?.org?.brandName?.trim();
  let brandData = null;
  if (brandName) {
    try {
      brandData = await loadAnalytics(req.tenant.orgId, brandName);
    } catch (err) {
      console.warn(`[keywords/recommendations] Brand analytics unavailable: ${err.message}`);
    }
  }

  // 5. Cross-reference: brand-analytics keywords already in this product's campaigns
  const termsInCampaigns = new Set(classified.map(t => norm(t.searchTerm)));

  const newKeywords = [];
  if (brandData) {
    for (const k of brandData.dominant ?? []) {
      if (!termsInCampaigns.has(norm(k.searchTerm))) {
        newKeywords.push({
          term:           k.searchTerm,
          source:         'BRAND_ANALYTICS',
          signal:         'DOMINANT',
          volume:         k.volume,
          purchaseShare:  k.purchaseShare,
          rationale:      `Brand wins ${k.purchaseShare}% of purchases organically (${k.volume} weekly searches) — bid on it as exact match`,
        });
      }
    }
    for (const k of (brandData.opportunities ?? []).slice(0, 30)) {
      if (!termsInCampaigns.has(norm(k.searchTerm))) {
        newKeywords.push({
          term:      k.searchTerm,
          source:    'BRAND_ANALYTICS',
          signal:    'OPPORTUNITY',
          volume:    k.volume,
          rationale: `High-volume query (${k.volume} weekly searches) where the brand has weak presence — test bids`,
        });
      }
    }
  }

  // 6. Listing-side recommendations: keywords that should live in the
  //    title / bullets / description / generic keyword field.
  const forListingMap = new Map();
  const pushListing = (keyword, entry) => {
    const k = norm(keyword);
    if (!k) return;
    const existing = forListingMap.get(k);
    if (!existing || entry.score > existing.score) forListingMap.set(k, { keyword, ...entry });
  };

  for (const k of brandData?.dominant ?? []) {
    pushListing(k.searchTerm, {
      source: 'BRAND_ANALYTICS', signal: 'DOMINANT', score: 100,
      reason: `Brand wins ${k.purchaseShare}% of purchases — must appear in title or bullets`,
    });
  }
  for (const k of brandData?.weak ?? []) {
    if (k.diagnosis === 'LISTING_QUALITY') {
      pushListing(k.searchTerm, {
        source: 'BRAND_ANALYTICS', signal: 'LISTING_GAP', score: 85,
        reason: `Visible (${k.impressionShare}% impression share) but converting poorly — listing copy likely doesn't match query intent`,
      });
    }
  }
  for (const t of scaleUp.slice(0, 30)) {
    pushListing(t.searchTerm, {
      source: 'SEARCH_TERM_REPORT', signal: 'CONVERTING', score: 90,
      reason: `${t.purchases} purchases via ads (ACoS ${t.acos}%) — worth ranking organically too`,
    });
  }
  for (const t of addExact.slice(0, 30)) {
    pushListing(t.searchTerm, {
      source: 'SEARCH_TERM_REPORT', signal: 'CONVERTING', score: 75,
      reason: `${t.purchases} purchases at ACoS ${t.acos}% — pull into listing copy and generic keyword`,
    });
  }

  const forListing = [...forListingMap.values()].sort((a, b) => b.score - a.score);

  // 7. Summary metrics
  const totalWastedSpend      = addNeg.reduce((s, t) => s + (t.cost ?? 0), 0);
  const totalPotentialRevenue = scaleUp.reduce((s, t) => s + (t.sales ?? 0), 0);

  res.json({
    asin: asin ?? null,
    sku:  sku  ?? null,
    period: { startDate: start, endDate: end },
    sources: {
      searchTermReport: true,
      brandAnalytics:   !!brandData,
      productScope:     Array.isArray(productCampaignIds) ? productCampaignIds.length : null,
    },
    summary: {
      totalTerms:            classified.length,
      scaleUp:               scaleUp.length,
      addExact:              addExact.length,
      addNegative:           addNeg.length,
      watch:                 watch.length,
      newFromBrandAnalytics: newKeywords.length,
      listingCandidates:     forListing.length,
      totalWastedSpend:      +totalWastedSpend.toFixed(2),
      totalPotentialRevenue: +totalPotentialRevenue.toFixed(2),
    },
    recommendations: {
      forListing,
      forCampaigns: {
        scaleUp:    scaleUp.slice(0, 30),
        addExact:   addExact.slice(0, 30),
        addNegative: addNeg.slice(0, 30),
        watch:      watch.slice(0, 20),
        newKeywords,
      },
    },
  });
});

export default router;
