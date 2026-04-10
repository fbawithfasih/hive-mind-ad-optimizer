import express from 'express';
import { getCampaigns as getAmazonCampaigns } from '../../services/amazon-ads.js';
import mockCampaigns from '../../data/mock-campaigns.js';

const router = express.Router();

// GET /api/campaigns - Fetch campaigns (live or mock)
router.get('/', async (req, res) => {
  const profileId = req.query.profileId || process.env.AMAZON_DEFAULT_PROFILE_ID;

  try {
    if (profileId) {
      console.log(`Fetching live campaigns for profile ${profileId}...`);
      const campaigns = await getAmazonCampaigns(profileId);

      const formatted = campaigns.map(c => ({
        id: c.campaignId.toString(),
        name: c.name,
        status: c.state.toLowerCase(),
        budget: c.dailyBudget ?? 0,
        campaignType: c.campaignType,
        targetingType: c.targetingType,
        startDate: c.startDate,
        // Metrics require a separate reports API call
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

    // Fall back to mock data only if no profile configured
    console.log('No profile ID configured — returning mock campaign data');
    res.json(mockCampaigns);
    
  } catch (error) {
    console.error('Campaigns route error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch campaigns',
      message: error.message 
    });
  }
});

// GET /api/campaigns/:id - Get specific campaign
router.get('/:id', (req, res) => {
  const campaign = mockCampaigns.find(c => c.id === req.params.id);
  
  if (!campaign) {
    return res.status(404).json({ error: 'Campaign not found' });
  }
  
  res.json(campaign);
});

export default router;
