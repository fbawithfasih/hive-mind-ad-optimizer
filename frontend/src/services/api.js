import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
});

/**
 * Fetches all campaigns.
 * @returns {Promise<any>} The campaigns data.
 */
export async function getProfiles() {
  try {
    const response = await api.get('/profiles');
    return response.data;
  } catch (error) {
    console.error('Error fetching profiles:', error);
    throw error;
  }
}

export async function getCampaigns(profileId) {
  try {
    const params = profileId ? { profileId } : {};
    const response = await api.get('/campaigns', { params });
    return response.data;
  } catch (error) {
    console.error('Error fetching campaigns:', error);
    throw error;
  }
}

/**
 * Fetches a single campaign by ID.
 * @param {string|number} id - The campaign ID.
 * @returns {Promise<any>} The campaign data.
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
 * Executes an MCP command with optional conversation history.
 * @param {string} command - The command to execute.
 * @param {Array} [history=[]] - The conversation history.
 * @returns {Promise<any>} The execution result data.
 */
export async function startReports(profileId, startDate, endDate) {
  const params = {};
  if (profileId) params.profileId = profileId;
  if (startDate) params.startDate = startDate;
  if (endDate)   params.endDate   = endDate;
  const response = await api.get('/reports/start', { params });
  return response.data; // { reportId, campaigns, startDate, endDate }
}

export async function pollReportStatus(profileId, reportId) {
  const response = await api.get('/reports/status', { params: { profileId, reportId } });
  return response.data; // { status } or { status: 'COMPLETED', data: [] }
}

/** @deprecated kept for compatibility — use startReports + pollReportStatus */
export async function getReports(profileId, startDate, endDate) {
  return startReports(profileId, startDate, endDate);
}

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

export async function optimizeListingApi(payload) {
  try {
    const response = await api.post('/listings/optimize', payload);
    return response.data;
  } catch (error) {
    console.error('Error optimizing listing:', error);
    throw error;
  }
}

export async function getSearchTerms(profileId, startDate, endDate) {
  try {
    const params = {};
    if (profileId) params.profileId = profileId;
    if (startDate) params.startDate = startDate;
    if (endDate)   params.endDate   = endDate;
    const response = await api.get('/search-terms', { params });
    return response.data;
  } catch (error) {
    console.error('Error fetching search terms:', error);
    throw error;
  }
}

export async function getSearchTermsForProduct({ profileId, sku, asin, startDate, endDate }) {
  try {
    const params = {};
    if (profileId) params.profileId = profileId;
    if (sku)       params.sku       = sku;
    if (asin)      params.asin      = asin;
    if (startDate) params.startDate = startDate;
    if (endDate)   params.endDate   = endDate;
    const response = await api.get('/search-terms', { params });
    return response.data;
  } catch (error) {
    console.error('Error fetching product search terms:', error);
    throw error;
  }
}

export async function publishListing({ sku, title, bullets, description }) {
  const response = await api.put('/listings/update', { sku, title, bullets, description });
  return response.data;
}

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
