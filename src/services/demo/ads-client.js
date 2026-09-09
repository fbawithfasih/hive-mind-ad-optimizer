/**
 * An Ads client with the same surface as amazon-ads.js, backed by fixtures.
 *
 * Every read method returns exactly the shape the real one does, so the
 * routes that consume it cannot tell the difference — that is the whole
 * point. Report ids encode the window they were asked for, so polling is
 * stateless and a second replica answers the same as the first. Nothing
 * here touches the network, and the writes throw: sample data cannot be
 * changed, and a route that tries must say so rather than pretend.
 */

import { DemoDataError } from './index.js';
import { DEMO_CAMPAIGNS, searchTermsFor, campaignMetricsFor } from './fixtures.js';

const enrich = (r) => ({
  ...r,
  clickThroughRate: r.impressions > 0 ? r.clicks / r.impressions : 0,
  costPerClick:     r.clicks > 0 ? r.cost / r.clicks : 0,
  acosClicks14d:    r.sales14d > 0 ? (r.cost / r.sales14d) * 100 : null,
  roasClicks14d:    r.cost > 0 ? r.sales14d / r.cost : null,
});

const parseWindow = (reportId, prefix) => {
  const m = new RegExp(`^${prefix}:(\\d{4}-\\d{2}-\\d{2}):(\\d{4}-\\d{2}-\\d{2})$`).exec(String(reportId));
  if (!m) throw new Error(`Unknown demo report ${reportId}`);
  return { startDate: m[1], endDate: m[2] };
};

export const demoAdsClient = {
  // Profiles come from the stored SellerProfile row, never from here: sync
  // must reach the real branch and get the honest "not connected".
  async getProfiles() { return []; },

  async getCampaigns() {
    return DEMO_CAMPAIGNS.map((c) => ({
      campaignId: c.campaignId, name: c.name, state: c.state, dailyBudget: c.dailyBudget,
      campaignType: 'sponsoredProducts', targetingType: c.targetingType, startDate: c.startDate,
    }));
  },

  async getProductAdCampaigns() { return DEMO_CAMPAIGNS.map((c) => c.campaignId); },

  async startCampaignMetricsReport(_profileId, startDate, endDate) { return `demo-metrics:${startDate}:${endDate}`; },

  async checkReportStatus(_profileId, reportId) {
    const { startDate, endDate } = parseWindow(reportId, 'demo-metrics');
    return { status: 'COMPLETED', data: campaignMetricsFor(startDate, endDate) };
  },

  async getCampaignMetrics(_profileId, startDate, endDate) { return campaignMetricsFor(startDate, endDate); },

  async createSearchTermReport(_profileId, startDate, endDate) { return `demo-st:${startDate}:${endDate}`; },

  async pollSearchTermReport(_profileId, reportId, campaignIds = []) {
    const { startDate, endDate } = parseWindow(reportId, 'demo-st');
    let records = searchTermsFor(startDate, endDate);
    if (campaignIds.length > 0) {
      const idSet = new Set(campaignIds.map(String));
      records = records.filter((r) => idSet.has(String(r.campaignId)));
    }
    return { status: 'COMPLETED', data: records.map(enrich) };
  },

  async getSearchTermReport(_profileId, startDate, endDate) { return searchTermsFor(startDate, endDate); },

  async updateCampaigns()     { throw new DemoDataError('change campaigns'); },
  async addNegativeKeywords() { throw new DemoDataError('add negative keywords'); },
  async addKeywords()         { throw new DemoDataError('add keywords'); },

  setProfileRegions() { /* one profile, one region; nothing to learn */ },
};

export default demoAdsClient;
