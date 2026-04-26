import axios from 'axios';
import { profilesCache, campaignsCache, searchTermsCache } from '../utils/cache.js';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,  // send session cookie on every request
});

// ────────────────────────────────────────────────────────────────────────────
// Type Definitions (JSDoc typedefs for IDE support)
// ────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} Profile
 * @property {string|number} profileId - Unique profile identifier
 * @property {string} type - Profile type (e.g., 'seller', 'brand')
 * @property {Object} accountInfo - Account information
 * @property {string} accountInfo.name - Account display name
 * @property {string} countryCode - Country code (e.g., 'US', 'CA')
 * @property {string} currencyCode - Currency code (e.g., 'USD', 'CAD')
 */

/**
 * @typedef {Object} Campaign
 * @property {string|number} id - Campaign ID
 * @property {string|number} campaignId - Campaign ID (alternate)
 * @property {string} name - Campaign name
 * @property {string} status - Campaign status (enabled, paused, ended, archived)
 * @property {number} budget - Daily budget
 * @property {string} biddingStrategy - Bidding strategy type
 * @property {number} impressions - Number of impressions
 * @property {number} clicks - Number of clicks
 * @property {number} ctr - Click-through rate (0-1)
 * @property {number} spend - Total spend amount
 * @property {number} cpc - Cost per click
 * @property {number} purchases - Purchases in last 14 days
 * @property {number} sales - Sales amount in last 14 days
 * @property {number} acos - Advertising Cost of Sale (0-100)
 * @property {number} roas - Return on Ad Spend
 * @property {number} topOfSearch - Top of search impression share
 */

/**
 * @typedef {Object} SearchTerm
 * @property {string} searchTerm - The search term text
 * @property {string} campaignId - Associated campaign ID
 * @property {string} campaignName - Associated campaign name
 * @property {string} adGroupId - Associated ad group ID
 * @property {string} adGroupName - Associated ad group name
 * @property {string} targeting - Targeting type
 * @property {string} matchType - Match type (broad, phrase, exact)
 * @property {number} impressions - Number of impressions
 * @property {number} clicks - Number of clicks
 * @property {number} ctr - Click-through rate
 * @property {number} cost - Total cost
 * @property {number} cpc - Cost per click
 * @property {number} purchases - Purchases in 14 days
 * @property {number} sales - Sales amount in 14 days
 * @property {number} acos - ACoS percentage
 * @property {string} recommendation - AI recommendation (SCALE_UP, ADD_NEGATIVE, ADD_EXACT, WATCH)
 */

/**
 * @typedef {Object} ReportJob
 * @property {string} jobId - Unique job identifier
 * @property {string} status - Job status (pending, processing, completed, failed)
 * @property {number} progress - Progress percentage (0-100)
 * @property {string} step - Current step description
 * @property {any} report - Report data (populated when status === 'completed')
 * @property {string} error - Error message (populated when status === 'failed')
 */

// ────────────────────────────────────────────────────────────────────────────
// Auth API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Get current authenticated user information
 * @returns {Promise<{email: string, role: string}>} User data
 * @throws {Error} If not authenticated
 */
export async function getMeApi() {
  const res = await api.get('/auth/me');
  return res.data;
}

export async function loginApi(email, password) {
  const res = await api.post('/auth/login', { email, password });
  return res.data;
}

export async function signupApi(email, password, firstName = '', lastName = '') {
  const res = await api.post('/auth/signup', { email, password, firstName, lastName });
  return res.data;
}

export async function logoutApi() {
  await api.post('/auth/logout');
}

export async function forgotPasswordApi(email) {
  const res = await api.post('/auth/forgot-password', { email });
  return res.data;
}

export async function resetPasswordApi(token, password) {
  const res = await api.post('/auth/reset-password', { token, password });
  return res.data;
}

export async function verifyEmailApi(token) {
  const res = await api.get('/auth/verify-email', { params: { token } });
  return res.data;
}

export async function switchOrgApi(orgId) {
  const { data } = await api.post('/auth/switch-org', { orgId });
  return data;
}

export async function resendVerificationApi() {
  const res = await api.post('/auth/resend-verification');
  return res.data;
}

// ────────────────────────────────────────────────────────────────────────────
// Amazon connection (SP-API OAuth)
// ────────────────────────────────────────────────────────────────────────────

export async function getAmazonStatus() {
  const res = await api.get('/credentials/status');
  return res.data;
}

export async function disconnectAmazonApi(credentialId) {
  const res = await api.delete(`/credentials/${credentialId}`);
  return res.data;
}

export async function getOnboardingStatus() {
  const res = await api.get('/onboarding/status');
  return res.data;
}

// ────────────────────────────────────────────────────────────────────────────
// Profiles API
// ────────────────────────────────────────────────────────────────────────────

export async function getStoredProfilesApi() {
  const res = await api.get('/profiles');
  return res.data;
}

export async function syncProfilesApi() {
  const res = await api.post('/profiles/sync');
  return res.data;
}

export async function setDefaultProfileApi(profileId) {
  const res = await api.put(`/profiles/${profileId}/default`);
  return res.data;
}

// ────────────────────────────────────────────────────────────────────────────
// Team / Org Members API
// ────────────────────────────────────────────────────────────────────────────

export async function getOrgMembersApi(orgId) {
  const res = await api.get(`/orgs/${orgId}/members`);
  return res.data;
}

export async function addOrgMemberApi(orgId, email, role) {
  const res = await api.post(`/orgs/${orgId}/members`, { email, role });
  return res.data;
}

export async function updateOrgMemberRoleApi(orgId, userId, role) {
  const res = await api.put(`/orgs/${orgId}/members/${userId}`, { role });
  return res.data;
}

export async function removeOrgMemberApi(orgId, userId) {
  const res = await api.delete(`/orgs/${orgId}/members/${userId}`);
  return res.data;
}

export async function getBillingStatus() {
  const res = await api.get('/billing/status');
  return res.data;
}

export async function createCheckoutSession(tier) {
  const res = await api.post('/billing/checkout', { tier });
  return res.data; // { subscriptionId, keyId }
}

export async function verifyPaymentApi(paymentId, subscriptionId, signature) {
  const res = await api.post('/billing/verify', {
    razorpay_payment_id:       paymentId,
    razorpay_subscription_id:  subscriptionId,
    razorpay_signature:        signature,
  });
  return res.data;
}

export async function cancelSubscriptionApi() {
  const res = await api.post('/billing/cancel');
  return res.data;
}

export async function bulkOptimizeApi(items, model = 'gemini') {
  const res = await api.post('/listings/bulk-optimize', { items, model });
  return res.data;
}

export async function getBulkStatusApi(batchId) {
  const res = await api.get(`/listings/bulk-status/${batchId}`);
  return res.data;
}

export async function getListingHealth(asin) {
  const res = await api.get('/listings/health', { params: { asin } });
  return res.data;
}

export async function getKeywordRecommendations(params = {}) {
  const res = await api.get('/keywords/recommendations', { params });
  return res.data;
}

// ────────────────────────────────────────────────────────────────────────────
// Amazon Ads Data API (Profiles, Campaigns, Search Terms)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Fetch all Amazon Ads profiles accessible to current user
 * Cached for 24 hours (profiles rarely change)
 * @returns {Promise<Profile[]>} Array of profile objects
 * @throws {Error} If API call fails
 */
export async function getProfiles() {
  try {
    // Cache profiles with 24hr TTL - they rarely change
    return await profilesCache.getOrFetch('profiles', async () => {
      const response = await api.get('/profiles');
      return response.data;
    });
  } catch (error) {
    console.error('Error fetching profiles:', error);
    throw error;
  }
}

/**
 * Fetch campaigns for a specific profile (or all profiles if not specified)
 * Cached per profile for 5 minutes
 * @param {string|number} [profileId] - Optional profile ID. If omitted, fetches all campaigns
 * @returns {Promise<Campaign[]>} Array of campaign objects
 * @throws {Error} If API call fails
 */
export async function getCampaigns(profileId) {
  try {
    // Cache campaigns per profile with 5min TTL
    const cacheKey = profileId ? `campaigns:${profileId}` : 'campaigns';
    return await campaignsCache.getOrFetch(cacheKey, async () => {
      const params = profileId ? { profileId } : {};
      const response = await api.get('/campaigns', { params });
      return response.data;
    });
  } catch (error) {
    console.error('Error fetching campaigns:', error);
    throw error;
  }
}

/**
 * Fetch a single campaign by ID
 * @param {string|number} id - The campaign ID
 * @returns {Promise<Campaign>} Single campaign object
 * @throws {Error} If campaign not found or API call fails
 */
export async function getCampaign(id) {
  try {
    const response = await api.get(`/campaigns/${id}`);
    return response.data;
  } catch (error) {
    console.error(`Error fetching campaign ${id}:`, error);
    throw error;
  }
}

/**
 * Start a metrics report generation job
 * Creates a report and begins async metrics polling
 * @param {string|number} [profileId] - Optional profile ID
 * @param {string} startDate - ISO 8601 start date (YYYY-MM-DD)
 * @param {string} endDate - ISO 8601 end date (YYYY-MM-DD)
 * @returns {Promise<{reportId: string, campaigns: Campaign[], startDate: string, endDate: string}>}
 * @throws {Error} If API call fails
 */
export async function startReports(profileId, startDate, endDate) {
  const params = {};
  if (profileId) params.profileId = profileId;
  if (startDate) params.startDate = startDate;
  if (endDate)   params.endDate   = endDate;
  const response = await api.get('/reports/start', { params });
  return response.data;
}

/**
 * Poll report generation status
 * Call repeatedly until status === 'COMPLETED' or error occurs
 * @param {string|number} [profileId] - Profile ID associated with report
 * @param {string} reportId - The report ID from startReports()
 * @returns {Promise<{status: string, data?: any[], error?: string}>} Status object
 *   - status: 'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'
 *   - data: Array of metrics (when COMPLETED)
 *   - error: Error message (when FAILED)
 * @throws {Error} If API call fails
 */
export async function pollReportStatus(profileId, reportId) {
  const response = await api.get('/reports/status', { params: { profileId, reportId } });
  return response.data;
}

/**
 * @deprecated Use startReports() + pollReportStatus() instead
 * Legacy wrapper for backward compatibility
 */
export async function getReports(profileId, startDate, endDate) {
  return startReports(profileId, startDate, endDate);
}

// ────────────────────────────────────────────────────────────────────────────
// Listings API (Product Management & Optimization)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Look up a product by ASIN or SKU
 * @param {string} [asin] - Amazon Standard Identification Number
 * @param {string} [sku] - Seller SKU
 * @returns {Promise<{sku: string, asin: string, title: string, productType: string, bullets: string[]}>}
 * @throws {Error} If product not found or API call fails
 */
export async function lookupProduct(asin, sku) {
  try {
    const params = {};
    if (asin) params.asin = asin;
    if (sku)  params.sku  = sku;
    const response = await api.get('/listings/lookup', { params });
    return response.data;
  } catch (error) {
    console.error('Error looking up product:', error);
    throw error;
  }
}

/**
 * Optimize a product listing using AI
 * @param {Object} payload - Optimization request
 * @param {string} payload.sku - Product SKU
 * @param {string} payload.productType - Amazon product type
 * @param {string} payload.title - Current product title
 * @param {string[]} payload.bullets - Current bullet points
 * @param {string} payload.description - Current description
 * @returns {Promise<{optimized: Object}>} Optimized listing data
 * @throws {Error} If optimization fails
 */
export async function optimizeListingApi(payload) {
  try {
    const response = await api.post('/listings/optimize', payload);
    return response.data;
  } catch (error) {
    console.error('Error optimizing listing:', error);
    throw error;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Search Terms API (Report & Analysis)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Fetch search terms report for profile and date range
 * Cached per profile/date range for 5 minutes
 * @param {string|number} [profileId] - Profile ID (optional)
 * @param {string} startDate - ISO 8601 start date (YYYY-MM-DD)
 * @param {string} endDate - ISO 8601 end date (YYYY-MM-DD)
 * @returns {Promise<SearchTerm[]>} Array of search term records with recommendations
 * @throws {Error} If API call fails
 */
export async function getSearchTerms(profileId, startDate, endDate) {
  try {
    // Cache search terms with 5min TTL - same date ranges are often requested repeatedly
    const cacheKey = `search-terms:${profileId || 'all'}:${startDate || ''}:${endDate || ''}`;
    return await searchTermsCache.getOrFetch(cacheKey, async () => {
      const params = {};
      if (profileId) params.profileId = profileId;
      if (startDate) params.startDate = startDate;
      if (endDate)   params.endDate   = endDate;
      const response = await api.get('/search-terms', { params });
      return response.data;
    });
  } catch (error) {
    console.error('Error fetching search terms:', error);
    throw error;
  }
}

/**
 * Fetch search terms for a specific product
 * Cached per product/date range for 5 minutes
 * @param {Object} params - Query parameters
 * @param {string|number} [params.profileId] - Profile ID
 * @param {string} [params.sku] - Product SKU
 * @param {string} [params.asin] - Product ASIN
 * @param {string} params.startDate - ISO 8601 start date
 * @param {string} params.endDate - ISO 8601 end date
 * @returns {Promise<SearchTerm[]>} Search terms for the product
 * @throws {Error} If API call fails
 */
export async function getSearchTermsForProduct({ profileId, sku, asin, startDate, endDate }) {
  try {
    // Cache product search terms with 5min TTL
    const cacheKey = `search-terms-product:${profileId || 'all'}:${sku || ''}:${asin || ''}:${startDate || ''}:${endDate || ''}`;
    return await searchTermsCache.getOrFetch(cacheKey, async () => {
      const params = {};
      if (profileId) params.profileId = profileId;
      if (sku)       params.sku       = sku;
      if (asin)      params.asin      = asin;
      if (startDate) params.startDate = startDate;
      if (endDate)   params.endDate   = endDate;
      const response = await api.get('/search-terms', { params });
      return response.data;
    });
  } catch (error) {
    console.error('Error fetching product search terms:', error);
    throw error;
  }
}

/**
 * Publish optimized listing content to Amazon
 * @param {Object} params - Listing update parameters
 * @param {string} params.sku - Product SKU
 * @param {string} params.productType - Amazon product type
 * @param {string} params.title - Product title
 * @param {string[]} params.bullets - Bullet points
 * @param {string} params.description - Product description
 * @returns {Promise<{success: boolean, sku: string}>} Update result
 * @throws {Error} If publish fails
 */
export async function publishListing({ sku, productType, title, bullets, description }) {
  const response = await api.put('/listings/update', { sku, productType, title, bullets, description });
  return response.data;
}

// ────────────────────────────────────────────────────────────────────────────
// Reporting Agent API (Background Report Generation)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Start a background report generation job
 * Returns immediately; use pollReportJob() to track progress
 * @param {Object} params - Report job parameters
 * @param {string} params.reportType - Type of report (PERFORMANCE, SUMMARY, INVENTORY, etc.)
 * @param {string|number} [params.profileId] - Optional profile ID
 * @param {string} params.startDate - ISO 8601 start date
 * @param {string} params.endDate - ISO 8601 end date
 * @param {string} [params.model='claude'] - AI model to use (claude, gemini)
 * @returns {Promise<{jobId: string, startDate: string, endDate: string}>} Job info
 * @throws {Error} If job creation fails
 */
export async function startReportJob({ reportType, profileId, startDate, endDate, model = 'claude' }) {
  const response = await api.post('/reporting-agent/start', { reportType, profileId, startDate, endDate, model });
  return response.data;
}

/**
 * Poll report job status
 * Call repeatedly until status is 'completed' or 'failed'
 * @param {string} jobId - Job ID from startReportJob()
 * @returns {Promise<ReportJob>} Current job status and progress
 * @throws {Error} If API call fails
 */
export async function pollReportJob(jobId) {
  const response = await api.get('/reporting-agent/poll', { params: { jobId } });
  return response.data;
}

// ────────────────────────────────────────────────────────────────────────────
// MCP Command Execution API (AI Commands)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Execute an MCP command with optional conversation history
 * Used for AI-powered commands and analysis
 * @param {string} command - The command or instruction to execute
 * @param {Array<{role: string, content: string}>} [history=[]] - Conversation history
 * @param {string} [model='gemini'] - AI model to use (gemini, claude)
 * @returns {Promise<{text: string, markdown: string, suggestions: string[]}>} Command result
 * @throws {Error} If command execution fails
 */
export async function executeCommand(command, history = [], model = 'gemini') {
  try {
    const response = await api.post('/mcp/execute', { command, history, model });
    return response.data;
  } catch (error) {
    console.error('Error executing command:', error);
    throw error;
  }
}

export default api;
