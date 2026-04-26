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
      const campaigns = await req.adsClient.getCampaigns(profileId);

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

// GET /api/campaigns/:id
router.get('/:id', (req, res) => {
  const campaign = mockCampaigns.find((c) => c.id === req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  res.json(campaign);
});

export default router;
