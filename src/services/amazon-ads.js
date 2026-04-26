import axios from 'axios';
import { gunzipSync } from 'zlib';
import dotenv from 'dotenv';
import { getOrCreateTokenManager } from './auth-utils.js';

dotenv.config({ override: true });

// ─────────────────────────────────────────────────────────────────────────────
// Client factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create an Amazon Ads API client bound to specific credentials.
 *
 * @param {object} credentials
 * @param {string} credentials.clientId
 * @param {string} credentials.clientSecret
 * @param {string} credentials.refreshToken
 * @param {string} [credentials.cacheKey]  - Stable key for token manager reuse
 */
export function createAdsClient({ clientId, clientSecret, refreshToken, cacheKey }) {
  const key = cacheKey ?? `ads:${clientId}:${(refreshToken ?? '').slice(-8)}`;

  async function getAccessToken() {
    const manager = getOrCreateTokenManager(key, clientId, clientSecret, refreshToken, 'Ads API');
    return manager.getToken();
  }

  function adsHeaders(token, profileId, extra = {}) {
    return {
      Authorization: `Bearer ${token}`,
      'Amazon-Advertising-API-ClientId': clientId,
      ...(profileId ? { 'Amazon-Advertising-API-Scope': profileId.toString() } : {}),
      ...extra,
    };
  }

  async function getProfiles() {
    const token = await getAccessToken();
    const res = await axios.get('https://advertising-api.amazon.com/v2/profiles', {
      headers: adsHeaders(token),
    });
    console.log(`✅ Fetched ${res.data.length} profiles`);
    return res.data;
  }

  async function getCampaigns(profileId) {
    const token = await getAccessToken();
    const res = await axios.get('https://advertising-api.amazon.com/v2/campaigns', {
      headers: adsHeaders(token, profileId),
    });
    console.log(`✅ Fetched ${res.data.length} campaigns for profile ${profileId}`);
    return res.data;
  }

  async function getProductAdCampaigns(profileId, { sku, asin } = {}) {
    const token = await getAccessToken();
    const headers = adsHeaders(token, profileId);
    const allAds = [];
    const pageSize = 5000;
    let startIndex = 0;

    console.log(`Fetching all SP product ads for profile ${profileId}…`);
    try {
      while (true) {
        const url = 'https://advertising-api.amazon.com/v2/sp/productAds';
        const params = { stateFilter: 'enabled,paused,archived', count: pageSize, startIndex };
        console.log(`  GET ${url} params:`, params);
        const res = await axios.get(url, { params, headers });
        console.log(`  Response status: ${res.status}, data type: ${typeof res.data}, isArray: ${Array.isArray(res.data)}`);
        const page = Array.isArray(res.data) ? res.data : [];
        allAds.push(...page);
        if (page.length < pageSize) break;
        startIndex += pageSize;
      }
    } catch (e) {
      const status = e.response?.status;
      const data   = e.response?.data;
      console.error(`❌ getProductAdCampaigns error [${status}]:`, JSON.stringify(data));
      throw new Error(`Failed to get product ad campaigns: ${data?.message ?? data?.code ?? e.message}`);
    }

    console.log(`Fetched ${allAds.length} total product ads — filtering by ${sku ? `SKU: ${sku}` : `ASIN: ${asin}`}`);
    const filtered = allAds.filter(ad => {
      if (sku)  return ad.sku?.toLowerCase()  === sku.toLowerCase();
      if (asin) return ad.asin?.toLowerCase() === asin.toLowerCase();
      return false;
    });

    const campaignIds = [...new Set(filtered.map(ad => ad.campaignId?.toString()).filter(Boolean))];
    console.log(`✅ Found ${filtered.length} ads for ${sku || asin} → ${campaignIds.length} unique campaigns`);
    return campaignIds;
  }

  async function startCampaignMetricsReport(profileId, startDate, endDate) {
    const token = await getAccessToken();
    const h = adsHeaders(token, profileId);

    console.log(`Creating SP metrics report for profile ${profileId} (${startDate} → ${endDate})…`);
    let createRes;
    try {
      createRes = await axios.post(
        'https://advertising-api.amazon.com/reporting/reports',
        {
          name: `SP Campaign Metrics ${Date.now()}`,
          startDate,
          endDate,
          configuration: {
            adProduct: 'SPONSORED_PRODUCTS',
            groupBy: ['campaign'],
            columns: [
              'campaignId', 'campaignName', 'campaignStatus',
              'impressions', 'clicks', 'clickThroughRate',
              'cost', 'costPerClick',
              'purchases14d', 'sales14d',
              'acosClicks14d', 'roasClicks14d',
              'topOfSearchImpressionShare',
              'campaignBudgetAmount', 'campaignBiddingStrategy',
            ],
            reportTypeId: 'spCampaigns',
            timeUnit: 'SUMMARY',
            format: 'GZIP_JSON',
          },
        },
        {
          headers: {
            ...h,
            'Content-Type': 'application/vnd.createasyncreportrequest.v3+json',
            Accept: 'application/vnd.createasyncreportrequest.v3+json',
          },
        }
      );
    } catch (e) {
      if (e.response?.status === 425) {
        const detail = e.response.data?.detail ?? '';
        const match  = detail.match(/([0-9a-f-]{36})/i);
        if (match) {
          console.log(`↩️  Duplicate report detected — reusing ${match[1]}`);
          return match[1];
        }
        throw new Error(`Report create 425 (no reportId): ${detail}`);
      }
      console.error('❌ Report create error:', e.response?.status, JSON.stringify(e.response?.data));
      throw new Error(`Report create failed ${e.response?.status}: ${JSON.stringify(e.response?.data)}`);
    }

    const reportId = createRes.data.reportId;
    console.log(`Report ${reportId} created`);
    return reportId;
  }

  async function checkReportStatus(profileId, reportId) {
    const token = await getAccessToken();
    const h = adsHeaders(token, profileId);

    let poll;
    try {
      poll = await axios.get(`https://advertising-api.amazon.com/reporting/reports/${reportId}`, { headers: h });
    } catch (e) {
      throw new Error(`Poll failed ${e.response?.status}: ${JSON.stringify(e.response?.data)}`);
    }

    const { status, url } = poll.data;
    console.log(`  Report ${reportId} status: ${status}`);

    if (status === 'COMPLETED') {
      const dlRes = await axios.get(url, { responseType: 'arraybuffer' });
      const data  = JSON.parse(gunzipSync(Buffer.from(dlRes.data)).toString());
      console.log(`✅ Report downloaded — ${data.length} SP campaign records`);
      return { status: 'COMPLETED', data };
    }
    if (status === 'FAILED')  throw new Error(`Report ${reportId} failed: ${poll.data.failureReason ?? 'unknown'}`);
    if (status === 'EXPIRED') throw new Error(`Report ${reportId} expired before download`);
    return { status };
  }

  /** @deprecated Use startCampaignMetricsReport + checkReportStatus */
  async function getCampaignMetrics(profileId, startDate, endDate) {
    const reportId = await startCampaignMetricsReport(profileId, startDate, endDate);
    for (let i = 0; i < 36; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const result = await checkReportStatus(profileId, reportId);
      if (result.status === 'COMPLETED') return result.data;
    }
    throw new Error('Report timed out after 3 minutes');
  }

  async function getSearchTermReport(profileId, startDate, endDate, campaignIds = []) {
    const token = await getAccessToken();
    const h = adsHeaders(token, profileId);

    const campaignLabel = campaignIds.length ? ` [${campaignIds.length} campaigns]` : '';
    console.log(`Creating SP search term report for profile ${profileId} (${startDate} → ${endDate})${campaignLabel}…`);

    const reportConfig = {
      adProduct: 'SPONSORED_PRODUCTS',
      groupBy: ['searchTerm'],
      columns: [
        'campaignId', 'campaignName',
        'targeting', 'matchType', 'searchTerm',
        'impressions', 'clicks', 'clickThroughRate',
        'cost', 'costPerClick',
        'purchases14d', 'sales14d',
        'acosClicks14d', 'roasClicks14d',
      ],
      reportTypeId: 'spSearchTerm',
      timeUnit: 'SUMMARY',
      format: 'GZIP_JSON',
    };
    if (campaignIds.length > 0) {
      reportConfig.filters = [{ field: 'campaignId', values: campaignIds }];
    }

    let createRes;
    try {
      createRes = await axios.post(
        'https://advertising-api.amazon.com/reporting/reports',
        {
          name: `SP Search Term Report ${Date.now()}`,
          startDate,
          endDate,
          configuration: reportConfig,
        },
        {
          headers: {
            ...h,
            'Content-Type': 'application/vnd.createasyncreportrequest.v3+json',
            Accept: 'application/vnd.createasyncreportrequest.v3+json',
          },
        }
      );
    } catch (e) {
      if (e.response?.status === 425) {
        const detail = e.response.data?.detail ?? '';
        const match  = detail.match(/([0-9a-f-]{36})/i);
        if (match) {
          console.log(`↩️  Duplicate search term report — reusing ${match[1]}`);
          createRes = { data: { reportId: match[1] } };
        } else {
          throw new Error(`Search term report 425 (no reportId): ${detail}`);
        }
      } else {
        console.error('❌ Search term report create error:', e.response?.status, JSON.stringify(e.response?.data));
        throw new Error(`Search term report create failed ${e.response?.status}: ${JSON.stringify(e.response?.data)}`);
      }
    }

    const reportId = createRes.data.reportId;
    console.log(`Search term report ${reportId} created — polling…`);

    for (let i = 0; i < 36; i++) {
      await new Promise(r => setTimeout(r, 5000));
      let poll;
      try {
        poll = await axios.get(`https://advertising-api.amazon.com/reporting/reports/${reportId}`, { headers: h });
      } catch (e) {
        throw new Error(`Search term poll failed ${e.response?.status}: ${JSON.stringify(e.response?.data)}`);
      }
      const { status, url } = poll.data;
      console.log(`  ST Poll ${i + 1}: ${status}`);

      if (status === 'COMPLETED') {
        const dlRes = await axios.get(url, { responseType: 'arraybuffer' });
        const records = JSON.parse(gunzipSync(Buffer.from(dlRes.data)).toString());
        console.log(`✅ Search term report downloaded — ${records.length} records`);
        return records;
      }
      if (status === 'FAILED')  throw new Error(`Search term report ${reportId} failed: ${poll.data.failureReason ?? 'unknown'}`);
      if (status === 'EXPIRED') throw new Error(`Search term report ${reportId} expired`);
    }

    throw new Error('Search term report timed out after 3 minutes');
  }

  /**
   * Batch-update campaign state and/or dailyBudget.
   *
   * @param {string} profileId
   * @param {Array<{campaignId: string|number, state?: string, dailyBudget?: number}>} updates
   * @returns {Promise<Array<{campaignId, code, description}>>}
   */
  async function updateCampaigns(profileId, updates) {
    const token = await getAccessToken();
    const body = updates.map(u => {
      const patch = { campaignId: Number(u.campaignId) };
      if (u.state !== undefined)       patch.state = u.state;
      if (u.dailyBudget !== undefined) patch.dailyBudget = u.dailyBudget;
      return patch;
    });

    const res = await axios.put(
      'https://advertising-api.amazon.com/v2/campaigns',
      body,
      { headers: adsHeaders(token, profileId) }
    );
    console.log(`✅ Updated ${updates.length} campaigns for profile ${profileId}`);
    return res.data;
  }

  return {
    getProfiles,
    getCampaigns,
    getProductAdCampaigns,
    startCampaignMetricsReport,
    checkReportStatus,
    getCampaignMetrics,
    getSearchTermReport,
    updateCampaigns,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Default env-var client (singleton — backward compat for legacy imports)
// ─────────────────────────────────────────────────────────────────────────────

const _defaultClient = createAdsClient({
  clientId:     process.env.AMAZON_ADS_CLIENT_ID    ?? '',
  clientSecret: process.env.AMAZON_ADS_CLIENT_SECRET ?? '',
  refreshToken: process.env.AMAZON_ADS_REFRESH_TOKEN  ?? '',
  cacheKey:     'ads:default',
});

export const getProfiles                 = _defaultClient.getProfiles;
export const getCampaigns                = _defaultClient.getCampaigns;
export const getProductAdCampaigns       = _defaultClient.getProductAdCampaigns;
export const startCampaignMetricsReport  = _defaultClient.startCampaignMetricsReport;
export const checkReportStatus           = _defaultClient.checkReportStatus;
export const getCampaignMetrics          = _defaultClient.getCampaignMetrics;
export const getSearchTermReport         = _defaultClient.getSearchTermReport;
export const updateCampaigns             = _defaultClient.updateCampaigns;

export default _defaultClient;
