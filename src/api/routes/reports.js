import express from 'express';
import { prisma } from '../../db/prisma.js';

const router = express.Router();

const MAX_RANGE_DAYS = 31;
const DAY_MS = 86400000;

function isoDay(d) {
  return new Date(d).toISOString().slice(0, 10);
}

// Clamp endDate to today; ensure startDate <= endDate. No length cap here —
// long ranges are split into windows server-side.
function normalizeDates(startDate, endDate) {
  const today = isoDay(Date.now());
  const end   = endDate > today ? today : endDate;
  const start = startDate > end ? end : startDate;
  return { startDate: start, endDate: end };
}

// Split [start, end] into consecutive windows of at most MAX_RANGE_DAYS.
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

// Aggregate per-campaign rows from N completed report windows into one row per
// campaign. Sums additive metrics; recomputes ratios; keeps latest status/budget.
function mergeWindowResults(windowResults) {
  const byCampaign = new Map();

  for (const rows of windowResults) {
    for (const row of rows) {
      const id = String(row.campaignId);
      const existing = byCampaign.get(id) ?? {
        campaignId:              row.campaignId,
        campaignName:            row.campaignName,
        campaignStatus:          row.campaignStatus,
        campaignBudgetAmount:    row.campaignBudgetAmount,
        campaignBiddingStrategy: row.campaignBiddingStrategy,
        impressions: 0, clicks: 0, cost: 0, purchases14d: 0, sales14d: 0,
      };
      existing.impressions  += Number(row.impressions  ?? 0);
      existing.clicks       += Number(row.clicks       ?? 0);
      existing.cost         += Number(row.cost         ?? 0);
      existing.purchases14d += Number(row.purchases14d ?? 0);
      existing.sales14d     += Number(row.sales14d     ?? 0);
      // Latest non-empty values win for static fields
      if (row.campaignName)            existing.campaignName            = row.campaignName;
      if (row.campaignStatus)          existing.campaignStatus          = row.campaignStatus;
      if (row.campaignBudgetAmount)    existing.campaignBudgetAmount    = row.campaignBudgetAmount;
      if (row.campaignBiddingStrategy) existing.campaignBiddingStrategy = row.campaignBiddingStrategy;
      byCampaign.set(id, existing);
    }
  }

  return [...byCampaign.values()].map(c => ({
    ...c,
    clickThroughRate: c.impressions > 0 ? c.clicks / c.impressions : 0,
    costPerClick:     c.clicks > 0 ? c.cost / c.clicks : 0,
    acosClicks14d:    c.sales14d > 0 ? (c.cost / c.sales14d) * 100 : null,
    roasClicks14d:    c.cost > 0 ? c.sales14d / c.cost : null,
  }));
}

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

  if (profile?.profileId) return profile.profileId;
  return req.hasOwnAdsCreds ? null : process.env.AMAZON_DEFAULT_PROFILE_ID;
}

/**
 * GET /api/reports/start
 *
 * Splits the requested range into ≤31-day windows, kicks off one Amazon
 * report per window, and returns the full list of reportIds.
 */
router.get('/start', async (req, res) => {
  const profileId = await resolveProfileId(req);
  if (!profileId) return res.status(400).json({ error: 'profileId required — no profile configured for this organization.' });

  const rawEnd   = req.query.endDate   || isoDay(Date.now());
  const rawStart = req.query.startDate || isoDay(Date.now() - 30 * DAY_MS);
  const { startDate, endDate } = normalizeDates(rawStart, rawEnd);
  const windows = splitIntoWindows(startDate, endDate);

  try {
    const campaignsPromise = req.adsClient.getCampaigns(profileId);
    const reportPromises = windows.map(w =>
      req.adsClient.startCampaignMetricsReport(profileId, w.startDate, w.endDate)
    );
    const [campaigns, ...reportIds] = await Promise.all([campaignsPromise, ...reportPromises]);

    res.json({
      reportIds,
      windows,
      campaigns,
      startDate,
      endDate,
      // Back-compat: clients that read .reportId still work for single-window cases
      reportId: reportIds[0],
    });
  } catch (err) {
    console.warn(`Reports start failed for org ${req.tenant?.orgId}: ${err.message} — returning empty result`);
    res.json({
      reportIds: [],
      windows,
      campaigns: [],
      startDate,
      endDate,
      reportId: null,
      notConnected: true,
      message: 'Amazon reports are unavailable for this account.',
    });
  }
});

/**
 * GET /api/reports/status?reportIds=a,b,c&profileId=
 *
 * Polls every reportId. Returns:
 *   - { status: 'PENDING' }  when any window is still pending/processing
 *   - { status: 'FAILED', error } when any window failed
 *   - { status: 'COMPLETED', data } with merged per-campaign rows when all done
 *
 * Accepts legacy `reportId` query param for single-window callers.
 */
router.get('/status', async (req, res) => {
  const profileId = await resolveProfileId(req);
  if (!profileId) return res.status(400).json({ error: 'profileId required — no profile configured for this organization.' });

  const idsParam = req.query.reportIds || req.query.reportId;
  if (!idsParam) return res.status(400).json({ error: 'reportIds required' });
  const reportIds = String(idsParam).split(',').map(s => s.trim()).filter(Boolean);

  try {
    const results = await Promise.all(
      reportIds.map(id => req.adsClient.checkReportStatus(profileId, id))
    );

    if (results.every(r => r.status === 'COMPLETED')) {
      const merged = mergeWindowResults(results.map(r => r.data ?? []));
      return res.json({ status: 'COMPLETED', data: merged });
    }
    // checkReportStatus throws on FAILED/EXPIRED, so any non-COMPLETED here is in flight
    res.json({ status: 'PENDING' });
  } catch (err) {
    console.error('Reports status error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
