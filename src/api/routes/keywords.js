import express from 'express';
import { classifySearchTerms } from '../../services/search-term-classifier.js';
import { isProfileAccessDenied, pruneInaccessibleProfile } from '../utils/pruneProfile.js';

const router = express.Router();

/**
 * GET /api/keywords/recommendations
 *
 * Fetches the search term report for the date range, classifies every term,
 * and returns structured recommendations grouped by action type with
 * prioritized, actionable suggestions for each group.
 *
 * Query params:
 *   profileId  — optional, falls back to org default
 *   startDate  — YYYY-MM-DD (default: 30 days ago)
 *   endDate    — YYYY-MM-DD (default: today)
 *   minClicks  — filter out terms with fewer clicks (default: 3)
 */
router.get('/recommendations', async (req, res) => {
  const {
    profileId: qProfileId,
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

  const classified = classifySearchTerms(rawTerms)
    .filter(t => (t.clicks ?? 0) >= threshold);

  const scaleUp    = classified.filter(t => t.recommendation === 'SCALE_UP')
    .sort((a, b) => (b.sales ?? 0) - (a.sales ?? 0));
  const addExact   = classified.filter(t => t.recommendation === 'ADD_EXACT')
    .sort((a, b) => (b.purchases ?? 0) - (a.purchases ?? 0));
  const addNeg     = classified.filter(t => t.recommendation === 'ADD_NEGATIVE')
    .sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0));
  const watch      = classified.filter(t => t.recommendation === 'WATCH')
    .sort((a, b) => (b.clicks ?? 0) - (a.clicks ?? 0));

  const totalWastedSpend = addNeg.reduce((s, t) => s + (t.cost ?? 0), 0);
  const totalPotentialRevenue = scaleUp.reduce((s, t) => s + (t.sales ?? 0), 0);

  // Build prioritized action list (top 5 per type)
  const actions = [
    ...scaleUp.slice(0, 5).map(t => ({
      priority: 'HIGH',
      action:   'SCALE_UP',
      term:     t.searchTerm,
      campaign: t.campaignName,
      adGroup:  t.adGroupName,
      rationale: `${t.purchases} purchases, ACoS ${t.acos}%, ROAS ${t.roas?.toFixed(2)}x — increase bid by 15–25%`,
      metric:   { spend: t.cost, sales: t.sales, acos: t.acos, roas: t.roas, purchases: t.purchases },
    })),
    ...addNeg.slice(0, 5).map(t => ({
      priority: 'HIGH',
      action:   'ADD_NEGATIVE',
      term:     t.searchTerm,
      campaign: t.campaignName,
      adGroup:  t.adGroupName,
      rationale: `${t.clicks} clicks, $${t.cost?.toFixed(2)} wasted, 0 purchases — add as negative (phrase recommended)`,
      metric:   { spend: t.cost, clicks: t.clicks, cpc: t.cpc },
    })),
    ...addExact.slice(0, 5).map(t => ({
      priority: 'MEDIUM',
      action:   'ADD_EXACT',
      term:     t.searchTerm,
      campaign: t.campaignName,
      adGroup:  t.adGroupName,
      rationale: `${t.purchases} purchases at ACoS ${t.acos}% — create exact match keyword to tighten control`,
      metric:   { spend: t.cost, sales: t.sales, acos: t.acos, purchases: t.purchases },
    })),
    ...watch.slice(0, 5).map(t => ({
      priority: 'LOW',
      action:   'WATCH',
      term:     t.searchTerm,
      campaign: t.campaignName,
      adGroup:  t.adGroupName,
      rationale: `${t.clicks} clicks, insufficient conversion data — monitor for another 7–14 days`,
      metric:   { spend: t.cost, clicks: t.clicks },
    })),
  ];

  res.json({
    period: { startDate: start, endDate: end },
    summary: {
      totalTerms:           classified.length,
      scaleUp:              scaleUp.length,
      addExact:             addExact.length,
      addNegative:          addNeg.length,
      watch:                watch.length,
      totalWastedSpend:     +totalWastedSpend.toFixed(2),
      totalPotentialRevenue: +totalPotentialRevenue.toFixed(2),
    },
    prioritizedActions: actions,
    details: {
      scaleUp:   scaleUp.slice(0, 30),
      addExact:  addExact.slice(0, 30),
      addNeg:    addNeg.slice(0, 30),
      watch:     watch.slice(0, 20),
    },
  });
});

export default router;
