import express from 'express';
import { classifySearchTerms } from '../../services/search-term-classifier.js';
import { isValidDateRange, isValidString } from '../utils/validation.js';
import { prisma } from '../../db/prisma.js';
import { isProfileAccessDenied, pruneInaccessibleProfile } from '../utils/pruneProfile.js';

const router = express.Router();

const MAX_RANGE_DAYS = 31;
const DAY_MS = 86400000;

function isoDay(d) {
  return new Date(d).toISOString().slice(0, 10);
}

// Amazon caps spSearchTerm at 31 days per report. Mirror /api/reports/start
// and split the requested range into ≤31-day windows.
function splitIntoWindows(startDate, endDate) {
  const windows = [];
  let cursor = new Date(startDate).getTime();
  const endMs = new Date(endDate).getTime();
  while (cursor <= endMs) {
    const winEnd = Math.min(cursor + (MAX_RANGE_DAYS - 1) * DAY_MS, endMs);
    windows.push({ startDate: isoDay(cursor), endDate: isoDay(winEnd) });
    cursor = winEnd + DAY_MS;
  }
  return windows;
}

// Aggregate per-window search-term rows into one row per
// (campaignId, adGroupId, matchType, searchTerm). Sums additive metrics and
// recomputes derived ratios so they reflect the full date range.
function mergeSearchTermWindows(windowResults) {
  const byKey = new Map();
  for (const rows of windowResults) {
    for (const r of rows) {
      const key = `${r.campaignId}|${r.adGroupId}|${r.matchType}|${r.searchTerm}`;
      const existing = byKey.get(key) ?? {
        campaignId:   r.campaignId,
        campaignName: r.campaignName,
        adGroupId:    r.adGroupId,
        adGroupName:  r.adGroupName,
        matchType:    r.matchType,
        searchTerm:   r.searchTerm,
        targeting:    r.targeting,
        impressions: 0, clicks: 0, cost: 0, purchases14d: 0, sales14d: 0,
      };
      existing.impressions  += Number(r.impressions  ?? 0);
      existing.clicks       += Number(r.clicks       ?? 0);
      existing.cost         += Number(r.cost         ?? 0);
      existing.purchases14d += Number(r.purchases14d ?? 0);
      existing.sales14d     += Number(r.sales14d     ?? 0);
      if (r.campaignName) existing.campaignName = r.campaignName;
      if (r.adGroupName)  existing.adGroupName  = r.adGroupName;
      if (r.targeting)    existing.targeting    = r.targeting;
      byKey.set(key, existing);
    }
  }
  return [...byKey.values()].map(c => ({
    ...c,
    clickThroughRate: c.impressions > 0 ? c.clicks / c.impressions : 0,
    costPerClick:     c.clicks > 0 ? c.cost / c.clicks : 0,
    acosClicks14d:    c.sales14d > 0 ? (c.cost / c.sales14d) * 100 : null,
    roasClicks14d:    c.cost > 0 ? c.sales14d / c.cost : null,
  }));
}

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

  const windows = splitIntoWindows(startDate, endDate);

  try {
    const reportIds = await Promise.all(
      windows.map(w => req.adsClient.createSearchTermReport(profileId, w.startDate, w.endDate))
    );
    res.json({
      reportIds,
      windows,
      profileId,
      startDate,
      endDate,
      campaignIds,
      // Back-compat: clients that still read .reportId continue to work for
      // single-window ranges.
      reportId: reportIds[0],
    });
  } catch (err) {
    console.error('Search terms start error:', err.message);
    if (isProfileAccessDenied(err)) {
      const newDefault = await pruneInaccessibleProfile(req.tenant?.orgId, profileId, req.adsClient);
      if (newDefault) {
        return res.status(409).json({
          error: 'That Amazon profile was no longer accessible. We synced your account and switched to a usable profile — please retry.',
          code: 'PROFILE_AUTO_RESYNCED',
          newDefaultProfileId: newDefault,
        });
      }
      return res.status(409).json({
        error: 'This Amazon profile is not accessible with your current Ads connection. We removed it from your account — please pick another profile or re-sync from Settings.',
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
  const idsParam = req.query.reportIds || req.query.reportId;
  if (!idsParam) return res.status(400).json({ error: 'reportId required' });
  const reportIds = String(idsParam).split(',').map(s => s.trim()).filter(Boolean);

  const profileId = await resolveProfileId(req);
  if (!profileId) return res.status(400).json({ error: 'profileId required' });

  const campaignIdsParam = req.query.campaignIds || '';
  const campaignIds = campaignIdsParam ? campaignIdsParam.split(',').map(s => s.trim()).filter(Boolean) : [];

  try {
    const results = await Promise.all(
      reportIds.map(id => req.adsClient.pollSearchTermReport(profileId, id, campaignIds))
    );

    const failed = results.find(r => r.status === 'FAILED');
    if (failed) return res.json({ status: 'FAILED', error: failed.error });

    if (results.every(r => r.status === 'COMPLETED')) {
      const merged = mergeSearchTermWindows(results.map(r => r.data ?? []));
      const enriched = classifySearchTerms(merged);
      return res.json({ status: 'COMPLETED', searchTerms: enriched });
    }

    res.json({ status: 'PENDING' });
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

    // Amazon caps spSearchTerm at 31 days, so split the requested range into
    // windows and create one report per window.
    const windows = splitIntoWindows(startDate, endDate);
    const reportIds = await Promise.all(
      windows.map(w => req.adsClient.createSearchTermReport(profileId, w.startDate, w.endDate))
    );

    // Poll every report inline. Cloudflare allows ~100s before 524 — keep
    // each poll iteration short and bail with a clear timeout if Amazon is
    // still working when the budget runs out.
    const completed = new Map();
    for (let i = 0; i < 36; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const pending = reportIds.filter(id => !completed.has(id));
      if (pending.length === 0) break;

      const polled = await Promise.all(
        pending.map(id => req.adsClient.pollSearchTermReport(profileId, id, campaignIds)
          .then(r => ({ id, ...r }))
        )
      );
      for (const r of polled) {
        if (r.status === 'COMPLETED') completed.set(r.id, r.data ?? []);
        else if (r.status === 'FAILED') throw new Error(r.error);
      }
    }

    if (completed.size !== reportIds.length) throw new Error('Search term report timed out');

    const merged = mergeSearchTermWindows(reportIds.map(id => completed.get(id)));
    return res.json({
      startDate, endDate,
      searchTerms: classifySearchTerms(merged),
      product: sku || asin || null,
    });
  } catch (err) {
    console.error('Search terms route error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
