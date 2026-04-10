import express from 'express';
import { getCampaigns, getCampaignMetrics } from '../../services/amazon-ads.js';

const router = express.Router();

/**
 * GET /api/reports?profileId=&startDate=&endDate=
 *
 * Returns campaigns merged with SP performance metrics.
 * Waits for the async Amazon report to complete (~30-90s).
 */
router.get('/', async (req, res) => {
  const profileId = req.query.profileId || process.env.AMAZON_DEFAULT_PROFILE_ID;
  if (!profileId) return res.status(400).json({ error: 'profileId required' });

  const endDate   = req.query.endDate   || new Date().toISOString().slice(0, 10);
  const startDate = req.query.startDate || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  // Amazon Ads Reporting API: max 31-day range, data retained for ~60 days
  const diffDays = (new Date(endDate) - new Date(startDate)) / 86400000;
  if (diffDays > 31) {
    return res.status(400).json({ error: `Date range too large (${Math.round(diffDays)} days). Maximum is 31 days.` });
  }
  const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  if (startDate < sixtyDaysAgo) {
    return res.status(400).json({ error: `Start date ${startDate} is too far in the past. Amazon retains data for ~60 days.` });
  }

  try {
    // Fetch campaigns list + metrics in parallel
    const [campaigns, metrics] = await Promise.all([
      getCampaigns(profileId),
      getCampaignMetrics(profileId, startDate, endDate),
    ]);

    // Index metrics by campaignId
    const metricsMap = {};
    for (const m of metrics) metricsMap[m.campaignId] = m;

    const merged = campaigns.map(c => {
      const m = metricsMap[c.campaignId] ?? {};
      return {
        id:            c.campaignId.toString(),
        name:          c.name,
        status:        (m.campaignStatus ?? c.state).toLowerCase().replace('campaign_status_', '').replace('campaign_', ''),
        budget:        c.dailyBudget ?? 0,
        campaignType:  c.campaignType,
        targetingType: c.targetingType,
        startDate:     c.startDate,
        biddingStrategy: m.campaignBiddingStrategy ?? null,
        // Performance metrics
        impressions:   m.impressions    ?? null,
        clicks:        m.clicks         ?? null,
        ctr:           m.clickThroughRate != null ? +Number(m.clickThroughRate).toFixed(4) : null,
        spend:         m.cost           ?? null,
        cpc:           m.costPerClick   ?? null,
        purchases:     m.purchases14d   ?? null,
        sales:         m.sales14d       ?? null,
        acos:          m.acosClicks14d  != null ? +Number(m.acosClicks14d).toFixed(2) : null,
        roas:          m.roasClicks14d  ?? null,
        topOfSearch:   m.topOfSearchImpressionShare ?? null,
      };
    });

    res.json({ startDate, endDate, campaigns: merged });
  } catch (err) {
    console.error('Reports route error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
