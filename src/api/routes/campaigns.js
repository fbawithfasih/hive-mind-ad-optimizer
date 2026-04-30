import express from 'express';
import { prisma } from '../../db/prisma.js';
import mockCampaigns from '../../data/mock-campaigns.js';

const router = express.Router();

/**
 * Resolve profileId for this request:
 *   1. Query param ?profileId=
 *   2. Org's default SellerProfile in DB
 *   3. Any SellerProfile stored for the org
 *   4. AMAZON_DEFAULT_PROFILE_ID env var (legacy fallback)
 */
async function resolveProfileId(req) {
  if (req.query.profileId) return req.query.profileId;

  const profile = await prisma.sellerProfile.findFirst({
    where: { orgId: req.tenant.orgId },
    orderBy: { isDefault: 'desc' },
  });

  return profile?.profileId ?? process.env.AMAZON_DEFAULT_PROFILE_ID;
}

// GET /api/campaigns
router.get('/', async (req, res) => {
  try {
    const profileId = await resolveProfileId(req);

    if (profileId) {
      console.log(`Fetching live campaigns for profile ${profileId} (org ${req.tenant.orgId})…`);
      let campaigns;
      try {
        campaigns = await req.adsClient.getCampaigns(profileId);
      } catch (err) {
        console.warn(`Live campaigns fetch failed for org ${req.tenant.orgId}: ${err.message} — returning empty list`);
        return res.json([]);
      }

      const formatted = campaigns.map((c) => ({
        id: c.campaignId.toString(),
        name: c.name,
        status: c.state.toLowerCase(),
        budget: c.dailyBudget ?? 0,
        campaignType: c.campaignType,
        targetingType: c.targetingType,
        startDate: c.startDate,
        spend: null,
        impressions: null,
        clicks: null,
        sales: null,
        acos: null,
        roas: null,
        ctr: null,
      }));

      return res.json(formatted);
    }

    console.log('No profile configured for org — returning mock campaign data');
    res.json(mockCampaigns);
  } catch (error) {
    console.error('Campaigns route error:', error);
    res.status(500).json({ error: 'Failed to fetch campaigns', message: error.message });
  }
});

// PUT /api/campaigns/bulk — batch enable/pause/set-budget/adjust-budget
router.put('/bulk', async (req, res) => {
  try {
    const { action, campaignIds, value, currentBudgets } = req.body;
    const profileId = await resolveProfileId(req);
    if (!profileId) return res.status(400).json({ error: 'No Amazon profile configured for this account.' });
    if (!Array.isArray(campaignIds) || campaignIds.length === 0)
      return res.status(400).json({ error: 'campaignIds must be a non-empty array.' });

    let updates;
    if (action === 'enable') {
      updates = campaignIds.map(id => ({ campaignId: id, state: 'enabled' }));
    } else if (action === 'pause') {
      updates = campaignIds.map(id => ({ campaignId: id, state: 'paused' }));
    } else if (action === 'set-budget') {
      const budget = parseFloat(value);
      if (isNaN(budget) || budget < 1) return res.status(400).json({ error: 'Budget must be ≥ $1.' });
      updates = campaignIds.map(id => ({ campaignId: id, dailyBudget: budget }));
    } else if (action === 'adjust-budget') {
      const pct = parseFloat(value);
      if (isNaN(pct) || pct === 0) return res.status(400).json({ error: 'Percentage must be a non-zero number.' });
      if (!currentBudgets || typeof currentBudgets !== 'object')
        return res.status(400).json({ error: 'currentBudgets map required for adjust-budget.' });
      updates = campaignIds.map(id => ({
        campaignId: id,
        dailyBudget: Math.max(1, +((currentBudgets[id] ?? 10) * (1 + pct / 100)).toFixed(2)),
      }));
    } else {
      return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    const results = await req.adsClient.updateCampaigns(profileId, updates);
    const succeeded = results.filter(r => r.code === 'SUCCESS').length;
    const failed    = results.filter(r => r.code !== 'SUCCESS');
    res.json({ results, succeeded, failed, total: updates.length });
  } catch (err) {
    console.error('Bulk campaign update error:', err);
    res.status(500).json({ error: 'Bulk update failed', message: err.message });
  }
});

// GET /api/campaigns/:id
router.get('/:id', (req, res) => {
  const campaign = mockCampaigns.find((c) => c.id === req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  res.json(campaign);
});

export default router;
