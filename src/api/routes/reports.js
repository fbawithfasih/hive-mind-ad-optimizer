import express from 'express';
import { prisma } from '../../db/prisma.js';

const router = express.Router();

// Clamp dates to Amazon's ~60-day data retention window.
// Returns { startDate, endDate } safe to pass to the Ads API.
function clampDates(startDate, endDate) {
  const earliest = new Date(Date.now() - 59 * 86400000).toISOString().slice(0, 10);
  const today    = new Date().toISOString().slice(0, 10);
  return {
    startDate: startDate < earliest ? earliest : startDate,
    endDate:   endDate   > today    ? today    : endDate,
  };
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

  return profile?.profileId ?? process.env.AMAZON_DEFAULT_PROFILE_ID;
}

/**
 * GET /api/reports/start
 */
router.get('/start', async (req, res) => {
  const profileId = await resolveProfileId(req);
  if (!profileId) return res.status(400).json({ error: 'profileId required — no profile configured for this organization.' });

  const rawEnd   = req.query.endDate   || new Date().toISOString().slice(0, 10);
  const rawStart = req.query.startDate || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const { startDate, endDate } = clampDates(rawStart, rawEnd);

  try {
    const [campaigns, reportId] = await Promise.all([
      req.adsClient.getCampaigns(profileId),
      req.adsClient.startCampaignMetricsReport(profileId, startDate, endDate),
    ]);
    res.json({ reportId, campaigns, startDate, endDate });
  } catch (err) {
    console.error('Reports start error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/reports/status?reportId=&profileId=
 */
router.get('/status', async (req, res) => {
  const { reportId } = req.query;
  if (!reportId) return res.status(400).json({ error: 'reportId required' });

  const profileId = await resolveProfileId(req);
  if (!profileId) return res.status(400).json({ error: 'profileId required — no profile configured for this organization.' });

  try {
    const result = await req.adsClient.checkReportStatus(profileId, reportId);
    res.json(result);
  } catch (err) {
    console.error('Reports status error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
