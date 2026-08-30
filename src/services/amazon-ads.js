import { http, TIMEOUT_MS } from './http.js';
import { gunzipSync } from 'zlib';
import dotenv from 'dotenv';
import { getOrCreateTokenManager } from './auth-utils.js';
import { splitIntoSearchTermWindows, mergeSearchTermWindows } from './search-term-windows.js';

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

  // Amazon Ads is region-segmented. Refresh tokens are global, so the same
  // access token works across regions, but each per-profile API call must
  // hit the host for that profile's marketplace.
  const REGIONS = {
    NA: 'https://advertising-api.amazon.com',
    EU: 'https://advertising-api-eu.amazon.com',
    FE: 'https://advertising-api-fe.amazon.com',
  };
  const ADS_REGIONS = Object.entries(REGIONS).map(([name, host]) => ({ name, host }));

  // Country → region map. Used to route per-profile calls to the right host.
  const COUNTRY_REGION = {
    US: 'NA', CA: 'NA', MX: 'NA', BR: 'NA',
    UK: 'EU', GB: 'EU', DE: 'EU', FR: 'EU', IT: 'EU', ES: 'EU', NL: 'EU',
    SE: 'EU', PL: 'EU', BE: 'EU', IE: 'EU', TR: 'EU',
    ZA: 'EU', EG: 'EU', SA: 'EU', AE: 'EU', IN: 'EU',
    JP: 'FE', AU: 'FE', SG: 'FE',
  };

  // profileId (string) → country code, populated by getProfiles or
  // setProfileRegions(). Per-profile functions consult this to pick the host;
  // unknown profileIds default to NA for backwards compatibility.
  const profileCountry = new Map();

  function hostFor(profileId) {
    if (profileId == null) return REGIONS.NA;
    const country = profileCountry.get(String(profileId));
    const region  = COUNTRY_REGION[country] ?? 'NA';
    return REGIONS[region];
  }

  function rememberProfile(profile) {
    if (profile?.profileId != null && profile?.countryCode) {
      profileCountry.set(String(profile.profileId), profile.countryCode);
    }
  }

  /**
   * Pre-populate the profileId→country map. Call from middleware/workers
   * before making per-profile API calls so the right region is hit even
   * when getProfiles() hasn't been called this session.
   * @param {Iterable<{profileId: string|number, countryCode: string}>} profiles
   */
  function setProfileRegions(profiles) {
    for (const p of profiles ?? []) rememberProfile(p);
  }

  async function getProfiles() {
    const token = await getAccessToken();
    const results = await Promise.all(ADS_REGIONS.map(async ({ name, host }) => {
      try {
        const res = await http.get(`${host}/v2/profiles`, { headers: adsHeaders(token) });
        const list = Array.isArray(res.data) ? res.data : [];
        console.log(`✅ Fetched ${list.length} profiles from ${name}`);
        return list;
      } catch (err) {
        const status = err.response?.status ?? 'network';
        // 401/403 typically means the seller didn't authorize this region —
        // expected and not an error worth surfacing to the caller.
        const level = (status === 401 || status === 403) ? 'info' : 'warn';
        console[level === 'warn' ? 'warn' : 'log'](
          `⚠️  ${name} profiles fetch ${level === 'info' ? 'skipped' : 'failed'} (status ${status})`
        );
        return [];
      }
    }));
    const merged = results.flat();
    // De-dupe defensively in case Amazon ever returns the same profileId from two regions.
    const seen = new Set();
    const deduped = merged.filter(p => {
      const id = String(p.profileId);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    // Cache region info so subsequent per-profile calls route to the right host.
    deduped.forEach(rememberProfile);
    return deduped;
  }

  // Sponsored Products v3 — `/v2/campaigns` returns 404 "Method Not Found".
  // Paginates `POST /sp/campaigns/list` and normalizes each item to the v2
  // shape callers already expect (campaignId / name / state / dailyBudget /
  // campaignType / targetingType / startDate).
  async function getCampaigns(profileId) {
    const token = await getAccessToken();
    const headers = {
      ...adsHeaders(token, profileId),
      'Content-Type': 'application/vnd.spCampaign.v3+json',
      Accept:         'application/vnd.spCampaign.v3+json',
    };

    const all = [];
    let nextToken;
    do {
      const body = { maxResults: 100, ...(nextToken ? { nextToken } : {}) };
      const res = await http.post(
        `${hostFor(profileId)}/sp/campaigns/list`,
        body,
        { headers },
      );
      const page = Array.isArray(res.data?.campaigns) ? res.data.campaigns : [];
      all.push(...page);
      nextToken = res.data?.nextToken;
    } while (nextToken);

    const normalized = all.map(c => ({
      campaignId:    c.campaignId,
      name:          c.name,
      state:         c.state,
      dailyBudget:   c.budget?.budget ?? c.dailyBudget ?? 0,
      campaignType:  'sponsoredProducts',
      targetingType: c.targetingSetting?.toLowerCase?.() ?? c.targetingType,
      startDate:     c.startDate,
    }));

    console.log(`✅ Fetched ${normalized.length} campaigns for profile ${profileId}`);
    return normalized;
  }

  // Sponsored Products v3 — `/v2/sp/productAds` returns 404 "Method Not Found".
  // Server-side asin/skuFilter avoids fetching the entire ad set just to filter
  // client-side, which is what made listing-optimizer fall back to "all search
  // terms" when the v2 lookup failed.
  async function getProductAdCampaigns(profileId, { sku, asin } = {}) {
    const token = await getAccessToken();
    const headers = {
      ...adsHeaders(token, profileId),
      'Content-Type': 'application/vnd.spProductAd.v3+json',
      Accept:         'application/vnd.spProductAd.v3+json',
    };

    const filterKey = sku ? 'skuFilter' : asin ? 'asinFilter' : null;
    const filterVal = sku ?? asin;
    if (!filterKey) return [];

    console.log(`Fetching SP product ads for profile ${profileId} (${filterKey}=${filterVal})…`);
    const allAds = [];
    let nextToken;
    try {
      do {
        const body = {
          maxResults: 1000,
          [filterKey]: { include: [filterVal] },
          ...(nextToken ? { nextToken } : {}),
        };
        const res = await http.post(
          `${hostFor(profileId)}/sp/productAds/list`,
          body,
          { headers },
        );
        const page = Array.isArray(res.data?.productAds) ? res.data.productAds : [];
        allAds.push(...page);
        nextToken = res.data?.nextToken;
      } while (nextToken);
    } catch (e) {
      const status = e.response?.status;
      const data   = e.response?.data;
      console.error(`❌ getProductAdCampaigns error [${status}]:`, JSON.stringify(data));
      throw new Error(`Failed to get product ad campaigns: ${data?.message ?? data?.code ?? e.message}`);
    }

    const campaignIds = [...new Set(allAds.map(ad => ad.campaignId?.toString()).filter(Boolean))];
    console.log(`✅ Found ${allAds.length} ads for ${sku || asin} → ${campaignIds.length} unique campaigns`);
    return campaignIds;
  }

  async function startCampaignMetricsReport(profileId, startDate, endDate) {
    const token = await getAccessToken();
    const h = adsHeaders(token, profileId);

    console.log(`Creating SP metrics report for profile ${profileId} (${startDate} → ${endDate})…`);
    let createRes;
    try {
      createRes = await http.post(
        `${hostFor(profileId)}/reporting/reports`,
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
      poll = await http.get(`${hostFor(profileId)}/reporting/reports/${reportId}`, { headers: h });
    } catch (e) {
      throw new Error(`Poll failed ${e.response?.status}: ${JSON.stringify(e.response?.data)}`);
    }

    const { status, url } = poll.data;
    console.log(`  Report ${reportId} status: ${status}`);

    if (status === 'COMPLETED') {
      const dlRes = await http.get(url, { responseType: 'arraybuffer', timeout: TIMEOUT_MS.download });
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

  async function createSearchTermReport(profileId, startDate, endDate) {
    const token = await getAccessToken();
    const h = adsHeaders(token, profileId);

    console.log(`Creating SP search term report for profile ${profileId} (${startDate} → ${endDate})…`);

    // spSearchTerm only supports primitive metric columns.
    // clickThroughRate, costPerClick, acosClicks14d, roasClicks14d are NOT valid here
    // (they're computed columns only available for spCampaigns). We derive them after download.
    const reportConfig = {
      adProduct: 'SPONSORED_PRODUCTS',
      groupBy: ['searchTerm'],
      columns: [
        'campaignId', 'campaignName',
        'adGroupId', 'adGroupName',
        'matchType', 'searchTerm', 'targeting',
        'impressions', 'clicks',
        'cost',
        'purchases14d', 'sales14d',
      ],
      reportTypeId: 'spSearchTerm',
      timeUnit: 'SUMMARY',
      format: 'GZIP_JSON',
    };

    let createRes;
    try {
      createRes = await http.post(
        `${hostFor(profileId)}/reporting/reports`,
        { name: `SP Search Term Report ${Date.now()}`, startDate, endDate, configuration: reportConfig },
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
          return match[1];
        }
        throw new Error(`Search term report 425 (no reportId): ${detail}`);
      }
      console.error('❌ Search term report create error:', e.response?.status, JSON.stringify(e.response?.data));
      throw new Error(`Search term report create failed ${e.response?.status}: ${JSON.stringify(e.response?.data)}`);
    }

    const reportId = createRes.data.reportId;
    console.log(`Search term report created: ${reportId}`);
    return reportId;
  }

  async function pollSearchTermReport(profileId, reportId, campaignIds = []) {
    const token = await getAccessToken();
    const h = adsHeaders(token, profileId);

    let poll;
    try {
      poll = await http.get(`${hostFor(profileId)}/reporting/reports/${reportId}`, { headers: h });
    } catch (e) {
      throw new Error(`Search term poll failed ${e.response?.status}: ${JSON.stringify(e.response?.data)}`);
    }

    const { status, url } = poll.data;
    console.log(`ST report ${reportId} status: ${status}`);

    if (status === 'COMPLETED') {
      const dlRes = await http.get(url, { responseType: 'arraybuffer', timeout: TIMEOUT_MS.download });
      let records = JSON.parse(gunzipSync(Buffer.from(dlRes.data)).toString());
      console.log(`✅ Search term report downloaded — ${records.length} records`);
      if (campaignIds.length > 0) {
        const idSet = new Set(campaignIds.map(String));
        records = records.filter(r => idSet.has(String(r.campaignId)));
        console.log(`  Filtered to ${records.length} records for ${campaignIds.length} campaigns`);
      }
      // Derive computed metrics — these columns are not available for spSearchTerm
      records = records.map(r => ({
        ...r,
        clickThroughRate: r.impressions > 0 ? r.clicks / r.impressions : 0,
        costPerClick:     r.clicks > 0 ? r.cost / r.clicks : 0,
        acosClicks14d:    r.sales14d > 0 ? (r.cost / r.sales14d) * 100 : null,
        roasClicks14d:    r.cost > 0 ? r.sales14d / r.cost : null,
      }));
      return { status: 'COMPLETED', data: records };
    }

    if (status === 'FAILED')  return { status: 'FAILED',  error: poll.data.failureReason ?? 'Report failed' };
    if (status === 'EXPIRED') return { status: 'FAILED',  error: 'Report expired' };
    return { status: 'PENDING' };
  }

  /**
   * High-level helper: split [startDate, endDate] into ≤31-day windows
   * (Amazon's spSearchTerm cap), create one report per window, poll all
   * until they finish, and return the merged raw rows. Used by callers
   * that just want a single array of search-term records (Keyword
   * Intelligence, the reporting worker) without managing reportIds.
   */
  async function getSearchTermReport(profileId, startDate, endDate, {
    pollIntervalMs = 5000,
    maxAttempts    = 36,
  } = {}) {
    const windows = splitIntoSearchTermWindows(startDate, endDate);
    const reportIds = await Promise.all(
      windows.map(w => createSearchTermReport(profileId, w.startDate, w.endDate))
    );

    const completed = new Map();
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, pollIntervalMs));
      const pending = reportIds.filter(id => !completed.has(id));
      if (pending.length === 0) break;

      const polled = await Promise.all(
        pending.map(id => pollSearchTermReport(profileId, id, []).then(r => ({ id, ...r })))
      );
      for (const r of polled) {
        if (r.status === 'COMPLETED')      completed.set(r.id, r.data ?? []);
        else if (r.status === 'FAILED')    throw new Error(r.error);
      }
    }

    if (completed.size !== reportIds.length) {
      throw new Error('Search term report timed out');
    }
    return mergeSearchTermWindows(reportIds.map(id => completed.get(id)));
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

    const res = await http.put(
      `${hostFor(profileId)}/v2/campaigns`,
      body,
      { headers: adsHeaders(token, profileId) }
    );
    console.log(`✅ Updated ${updates.length} campaigns for profile ${profileId}`);
    return res.data;
  }

  /**
   * Add negative keywords at the ad-group level.
   * items: [{ campaignId, adGroupId, keywordText, matchType? }]
   * matchType defaults to 'negativePhrase'.
   */
  async function addNegativeKeywords(profileId, items) {
    const token = await getAccessToken();
    const body = items.map(k => ({
      campaignId:  Number(k.campaignId),
      adGroupId:   Number(k.adGroupId),
      state:       'enabled',
      keywordText: k.keywordText,
      matchType:   k.matchType ?? 'negativePhrase',
    }));
    const res = await http.post(
      `${hostFor(profileId)}/v2/sp/negativeKeywords`,
      body,
      { headers: adsHeaders(token, profileId) }
    );
    console.log(`✅ Submitted ${items.length} negative keywords for profile ${profileId}`);
    return Array.isArray(res.data) ? res.data : [];
  }

  /**
   * Add positive keywords (exact/phrase/broad) at the ad-group level.
   * items: [{ campaignId, adGroupId, keywordText, matchType?, bid? }]
   * matchType defaults to 'exact'. bid defaults to 0.75.
   */
  async function addKeywords(profileId, items) {
    const token = await getAccessToken();
    const body = items.map(k => ({
      campaignId:  Number(k.campaignId),
      adGroupId:   Number(k.adGroupId),
      state:       'enabled',
      keywordText: k.keywordText,
      matchType:   k.matchType ?? 'exact',
      bid:         k.bid ?? 0.75,
    }));
    const res = await http.post(
      `${hostFor(profileId)}/v2/sp/keywords`,
      body,
      { headers: adsHeaders(token, profileId) }
    );
    console.log(`✅ Submitted ${items.length} keywords for profile ${profileId}`);
    return Array.isArray(res.data) ? res.data : [];
  }

  return {
    getProfiles,
    getCampaigns,
    getProductAdCampaigns,
    startCampaignMetricsReport,
    checkReportStatus,
    getCampaignMetrics,
    createSearchTermReport,
    pollSearchTermReport,
    getSearchTermReport,
    updateCampaigns,
    addNegativeKeywords,
    addKeywords,
    setProfileRegions,
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
export const createSearchTermReport      = _defaultClient.createSearchTermReport;
export const pollSearchTermReport        = _defaultClient.pollSearchTermReport;
export const getSearchTermReport         = _defaultClient.getSearchTermReport;
export const updateCampaigns             = _defaultClient.updateCampaigns;
export const addNegativeKeywords         = _defaultClient.addNegativeKeywords;
export const addKeywords                 = _defaultClient.addKeywords;

export default _defaultClient;
