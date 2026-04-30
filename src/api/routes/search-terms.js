import express from 'express';
import { classifySearchTerms } from '../../services/search-term-classifier.js';
import { isValidDateRange, isValidString } from '../utils/validation.js';
import { prisma } from '../../db/prisma.js';

const router = express.Router();

async function resolveProfileId(req) {
  if (req.query.profileId) return req.query.profileId;
  const profile = await prisma.sellerProfile.findFirst({
    where: { orgId: req.tenant.orgId },
    orderBy: { isDefault: 'desc' },
  });
  if (profile?.profileId) return profile.profileId;
  // Only fall back to the global env-var profile for orgs without their own
  // Ads OAuth — using it with another org's refresh token returns 401.
  return req.hasOwnAdsCreds ? null : process.env.AMAZON_DEFAULT_PROFILE_ID;
}

function validateDates(startDate, endDate) {
  const dateValidation = isValidDateRange(startDate, endDate);
  if (!dateValidation.valid) return dateValidation.error;

  const diffDays = (new Date(endDate) - new Date(startDate)) / 86400000;
  if (diffDays > 65) return `Date range too large (${Math.round(diffDays)} days). Maximum is 65 days.`;

  const sixtyFiveDaysAgo = new Date(Date.now() - 65 * 86400000).toISOString().slice(0, 10);
  if (startDate < sixtyFiveDaysAgo) return `Start date ${startDate} is too far in the past. Amazon retains search term data for ~65 days.`;

  return null;
}

/**
 * POST /api/search-terms/start
 * Creates an async Amazon search term report, returns reportId immediately.
 * Frontend polls /status to avoid Cloudflare 524 timeout.
 */
router.post('/start', async (req, res) => {
  const profileId = await resolveProfileId(req);
  if (!profileId) return res.status(400).json({ error: 'profileId required — no profile configured for this organization.' });

  const endDate   = req.body.endDate   || new Date().toISOString().slice(0, 10);
  const startDate = req.body.startDate || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const campaignIds = Array.isArray(req.body.campaignIds) ? req.body.campaignIds : [];

  const dateErr = validateDates(startDate, endDate);
  if (dateErr) return res.status(400).json({ error: dateErr });

  try {
    const reportId = await req.adsClient.createSearchTermReport(profileId, startDate, endDate);
    res.json({ reportId, profileId, startDate, endDate, campaignIds });
  } catch (err) {
    console.error('Search terms start error:', err.message);
    if (/\b401\b|Unauthorized|does not have access/i.test(err.message)) {
      return res.status(409).json({
        error: 'This Amazon profile is not accessible with your current Ads connection.',
        code: 'PROFILE_ACCESS_DENIED',
        action: 'Open Settings → Amazon Profiles and re-sync, or pick a profile your Ads account owns.',
      });
    }
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/search-terms/status?reportId=&profileId=&campaignIds=
 * Polls the Amazon report status. Returns { status, data? } where status is PENDING | COMPLETED | FAILED.
 */
router.get('/status', async (req, res) => {
  const { reportId } = req.query;
  if (!reportId) return res.status(400).json({ error: 'reportId required' });

  const profileId = await resolveProfileId(req);
  if (!profileId) return res.status(400).json({ error: 'profileId required' });

  const campaignIdsParam = req.query.campaignIds || '';
  const campaignIds = campaignIdsParam ? campaignIdsParam.split(',').map(s => s.trim()).filter(Boolean) : [];

  try {
    const result = await req.adsClient.pollSearchTermReport(profileId, reportId, campaignIds);

    if (result.status === 'COMPLETED') {
      const enriched = classifySearchTerms(result.data);
      return res.json({ status: 'COMPLETED', searchTerms: enriched });
    }

    res.json({ status: result.status, error: result.error });
  } catch (err) {
    console.error('Search terms status error:', err.message);
    if (/\b401\b|Unauthorized|does not have access/i.test(err.message)) {
      return res.status(409).json({
        error: 'This Amazon profile is not accessible with your current Ads connection.',
        code: 'PROFILE_ACCESS_DENIED',
      });
    }
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/search-terms/bulk-actions
 * Apply keyword actions for a batch of classified search terms.
 *
 * Body: {
 *   profileId?: string,
 *   actions: [{
 *     type:        'ADD_NEGATIVE' | 'ADD_EXACT',
 *     searchTerm:  string,
 *     campaignId:  string,
 *     adGroupId:   string,
 *     bid?:        number   // only for ADD_EXACT; defaults to 0.75
 *   }]
 * }
 *
 * Returns: { added, duplicates, failed, results }
 */
router.post('/bulk-actions', async (req, res) => {
  const profileId = req.body.profileId || await resolveProfileId(req);
  if (!profileId) return res.status(400).json({ error: 'profileId required' });

  const actions = Array.isArray(req.body.actions) ? req.body.actions : [];
  if (!actions.length) return res.status(400).json({ error: 'actions array is required and must not be empty' });

  const negatives = actions
    .filter(a => a.type === 'ADD_NEGATIVE')
    .map(a => ({ campaignId: a.campaignId, adGroupId: a.adGroupId, keywordText: a.searchTerm }));

  const exact = actions
    .filter(a => a.type === 'ADD_EXACT')
    .map(a => ({ campaignId: a.campaignId, adGroupId: a.adGroupId, keywordText: a.searchTerm, bid: a.bid }));

  const results = [];
  let added = 0, duplicates = 0, failed = 0;

  function tally(apiResults, type) {
    for (const r of apiResults) {
      const code = r.code ?? 'SUCCESS';
      if (code === 'SUCCESS') { added++; results.push({ type, keywordId: r.keywordId, code }); }
      else if (code === 'DUPLICATE_VALUE') { duplicates++; results.push({ type, code }); }
      else { failed++; results.push({ type, code, details: r.details }); }
    }
  }

  try {
    if (negatives.length) {
      const r = await req.adsClient.addNegativeKeywords(profileId, negatives);
      tally(r, 'ADD_NEGATIVE');
    }
    if (exact.length) {
      const r = await req.adsClient.addKeywords(profileId, exact);
      tally(r, 'ADD_EXACT');
    }
    console.log(`[bulk-actions] profile=${profileId} added=${added} dup=${duplicates} failed=${failed}`);
    res.json({ added, duplicates, failed, results });
  } catch (err) {
    console.error('[search-terms/bulk-actions]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/search-terms (legacy — kept for backward compat, SKU/ASIN product lookup path)
 */
router.get('/', async (req, res) => {
  const profileId = await resolveProfileId(req);
  if (!profileId) return res.status(400).json({ error: 'profileId required — no profile configured for this organization.' });

  const endDate   = req.query.endDate   || new Date().toISOString().slice(0, 10);
  const startDate = req.query.startDate || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const { sku, asin } = req.query;

  const dateErr = validateDates(startDate, endDate);
  if (dateErr) return res.status(400).json({ error: dateErr });

  if (sku) { const v = isValidString(sku, 'sku'); if (!v.valid) return res.status(400).json({ error: v.error }); }
  if (asin) { const v = isValidString(asin, 'asin'); if (!v.valid) return res.status(400).json({ error: v.error }); }

  try {
    let campaignIds = [];
    if (sku || asin) {
      try {
        campaignIds = await req.adsClient.getProductAdCampaigns(profileId, { sku, asin });
      } catch (e) {
        console.warn(`Product ads lookup failed (${e.message}) — falling back to all search terms`);
      }
    }

    const reportId = await req.adsClient.createSearchTermReport(profileId, startDate, endDate);

    // Poll inline (only used by legacy/product path — short range expected)
    for (let i = 0; i < 36; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const result = await req.adsClient.pollSearchTermReport(profileId, reportId, campaignIds);
      if (result.status === 'COMPLETED') {
        return res.json({ startDate, endDate, searchTerms: classifySearchTerms(result.data), product: sku || asin || null });
      }
      if (result.status === 'FAILED') throw new Error(result.error);
    }
    throw new Error('Search term report timed out');
  } catch (err) {
    console.error('Search terms route error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
