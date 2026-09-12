/**
 * The demo client is indistinguishable from the real one to its callers.
 *
 * Every read method exists, returns the shape the routes expect, and answers
 * the same window the same way twice. The writes throw. And none of it can
 * reach the network — axios is stubbed to explode, and nothing explodes.
 */
jest.mock('axios', () => { throw new Error('demo client must not import axios'); });

import { demoAdsClient } from '../ads-client.js';
import { DEMO_CAMPAIGNS, DEMO_SEARCH_TERMS } from '../fixtures.js';

const REAL_SURFACE = [
  'getProfiles', 'getCampaigns', 'getProductAdCampaigns', 'startCampaignMetricsReport', 'checkReportStatus',
  'getCampaignMetrics', 'createSearchTermReport', 'pollSearchTermReport', 'getSearchTermReport',
  'updateCampaigns', 'addNegativeKeywords', 'addKeywords', 'setProfileRegions',
];

it('exposes every method the real client does', () => {
  for (const m of REAL_SURFACE) expect(typeof demoAdsClient[m]).toBe('function');
});

it('returns no profiles, so sync never learns about the sample from here', async () => {
  await expect(demoAdsClient.getProfiles()).resolves.toEqual([]);
});

it('lists campaigns in the normalised v2 shape', async () => {
  const list = await demoAdsClient.getCampaigns('demo-us');
  expect(list).toHaveLength(DEMO_CAMPAIGNS.length);
  expect(list[0]).toEqual({
    campaignId: expect.any(String), name: expect.any(String), state: expect.stringMatching(/enabled|paused/),
    dailyBudget: expect.any(Number), campaignType: 'sponsoredProducts', targetingType: expect.any(String), startDate: expect.any(String),
  });
});

describe('campaign metrics report', () => {
  it('completes immediately with one row per campaign in the report shape', async () => {
    const id = await demoAdsClient.startCampaignMetricsReport('demo-us', '2026-08-01', '2026-08-30');
    const res = await demoAdsClient.checkReportStatus('demo-us', id);
    expect(res.status).toBe('COMPLETED');
    expect(res.data).toHaveLength(DEMO_CAMPAIGNS.length);
    expect(Object.keys(res.data[0]).sort()).toEqual([
      'campaignBiddingStrategy', 'campaignBudgetAmount', 'campaignId', 'campaignName', 'campaignStatus',
      'clicks', 'cost', 'impressions', 'purchases14d', 'sales14d',
    ]);
  });

  it('refuses a report id it did not issue', async () => {
    await expect(demoAdsClient.checkReportStatus('demo-us', 'amzn-real-id')).rejects.toThrow(/Unknown demo report/);
  });
});

describe('search-term report', () => {
  it('completes with enriched rows and honours the campaign filter', async () => {
    const id = await demoAdsClient.createSearchTermReport('demo-us', '2026-08-01', '2026-08-30');
    const all = await demoAdsClient.pollSearchTermReport('demo-us', id);
    expect(all.status).toBe('COMPLETED');
    expect(all.data).toHaveLength(DEMO_SEARCH_TERMS.length);
    expect(all.data[0]).toMatchObject({
      clickThroughRate: expect.any(Number), costPerClick: expect.any(Number),
    });
    const one = await demoAdsClient.pollSearchTermReport('demo-us', id, ['demo-c2']);
    expect(one.data.length).toBeGreaterThan(0);
    expect(one.data.every((r) => r.campaignId === 'demo-c2')).toBe(true);
  });

  it('answers the same window identically twice, and a shorter window smaller', async () => {
    const a = await demoAdsClient.getSearchTermReport('demo-us', '2026-08-01', '2026-08-30');
    const b = await demoAdsClient.getSearchTermReport('demo-us', '2026-08-01', '2026-08-30');
    expect(a).toEqual(b);
    const week = await demoAdsClient.getSearchTermReport('demo-us', '2026-08-01', '2026-08-07');
    const sum = (rows) => rows.reduce((n, r) => n + r.clicks, 0);
    expect(sum(week)).toBeLessThan(sum(a) * 0.35);
    expect(sum(week)).toBeGreaterThan(sum(a) * 0.15);
  });
});

it.each(['updateCampaigns', 'addNegativeKeywords', 'addKeywords'])('%s refuses, naming the demo', async (m) => {
  await expect(demoAdsClient[m]('demo-us', [])).rejects.toMatchObject({ code: 'DEMO_READ_ONLY', message: expect.stringMatching(/Demo data is read-only/) });
});
