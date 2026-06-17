/**
 * Test suite for Amazon Ads API service
 * Validates token refresh, caching, and error handling
 */

import axios from 'axios';
import { getProfiles, getCampaigns } from '../amazon-ads.js';
import { invalidateTokenManager } from '../auth-utils.js';

// Mock axios to avoid real API calls
jest.mock('axios');

describe('Amazon Ads API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // mockReset (not just clearAllMocks) so persistent mockResolvedValue impls and
    // queued mock*Once values from a prior test don't leak into the next one —
    // e.g. the "reuse cached token" test sets axios.get.mockResolvedValue(...).
    axios.get.mockReset();
    axios.post.mockReset();
    // Clear the cached token so each test starts with a fresh token fetch.
    // The default client uses cacheKey 'ads:default' in the module-level registry.
    invalidateTokenManager('ads:default');
  });

  describe('Token Refresh', () => {
    it('should fetch and cache access token', async () => {
      // Mock successful token response
      axios.post.mockResolvedValueOnce({
        data: {
          access_token: 'test-token-123',
          expires_in: 3600,
        },
      });

      axios.get.mockResolvedValueOnce({
        data: [{ id: 'profile-1', name: 'Test Profile' }],
      });

      // First call should fetch token
      const result = await getProfiles();
      expect(result).toBeDefined();
      expect(axios.post).toHaveBeenCalledTimes(1);
    });

    it('should reuse cached token within expiry window', async () => {
      axios.post.mockResolvedValueOnce({
        data: {
          access_token: 'cached-token',
          expires_in: 3600,
        },
      });

      axios.get.mockResolvedValue({
        data: [{ id: 'p1' }],
      });

      // Call twice in quick succession
      await getProfiles();
      await getProfiles();

      // Token should only be fetched once (cached second time)
      expect(axios.post).toHaveBeenCalledTimes(1);
    });

    it('should handle token refresh errors', async () => {
      axios.post.mockRejectedValueOnce(new Error('Token endpoint down'));

      await expect(getProfiles()).rejects.toThrow('Token endpoint down');
    });

    it('should handle 401 unauthorized responses', async () => {
      const error = new Error('Unauthorized');
      error.response = { status: 401 };
      axios.post.mockRejectedValueOnce(error);

      await expect(getProfiles()).rejects.toThrow();
    });

    it('should handle 429 rate limit responses', async () => {
      const error = new Error('Rate Limited');
      error.response = { status: 429, headers: { 'retry-after': '60' } };
      axios.post.mockRejectedValueOnce(error);

      await expect(getProfiles()).rejects.toThrow();
    });

    it('should handle 503 service unavailable', async () => {
      const error = new Error('Service Unavailable');
      error.response = { status: 503 };
      axios.post.mockRejectedValueOnce(error);

      await expect(getProfiles()).rejects.toThrow();
    });
  });

  describe('getProfiles', () => {
    it('should fetch profiles successfully', async () => {
      axios.post.mockResolvedValueOnce({
        data: {
          access_token: 'token',
          expires_in: 3600,
        },
      });

      // getProfiles fetches every region (NA/EU/FE) and de-dupes by profileId,
      // so use a realistic shape and have the non-NA regions return nothing.
      const mockProfiles = [
        { profileId: 1, countryCode: 'US', accountInfo: { name: 'Profile 1', type: 'seller' } },
        { profileId: 2, countryCode: 'CA', accountInfo: { name: 'Profile 2', type: 'seller' } },
      ];

      axios.get
        .mockResolvedValueOnce({ data: mockProfiles }) // NA
        .mockResolvedValue({ data: [] });               // EU, FE

      const result = await getProfiles();
      expect(result).toEqual(mockProfiles);
      expect(axios.get).toHaveBeenCalledWith(
        'https://advertising-api.amazon.com/v2/profiles',
        expect.any(Object)
      );
    });

    it('should handle empty profile list', async () => {
      axios.post.mockResolvedValueOnce({
        data: { access_token: 'token', expires_in: 3600 },
      });

      axios.get.mockResolvedValueOnce({
        data: [],
      });

      const result = await getProfiles();
      expect(result).toEqual([]);
    });

    it('should pass correct authorization headers', async () => {
      axios.post.mockResolvedValueOnce({
        data: { access_token: 'test-token', expires_in: 3600 },
      });

      axios.get.mockResolvedValueOnce({
        data: [],
      });

      await getProfiles();

      const getCall = axios.get.mock.calls[0];
      expect(getCall[1].headers).toHaveProperty('Authorization');
      expect(getCall[1].headers.Authorization).toMatch(/^Bearer test-token/);
    });
  });

  describe('getCampaigns', () => {
    it('should fetch campaigns for profile and normalize v3 shape', async () => {
      axios.post.mockResolvedValueOnce({
        data: { access_token: 'token', expires_in: 3600 },
      });

      axios.post.mockResolvedValueOnce({
        data: {
          campaigns: [
            { campaignId: 'c1', name: 'Campaign 1', state: 'ENABLED',
              budget: { budget: 25, budgetType: 'DAILY' },
              targetingSetting: 'MANUAL', startDate: '2026-01-01' },
            { campaignId: 'c2', name: 'Campaign 2', state: 'PAUSED',
              budget: { budget: 10, budgetType: 'DAILY' },
              targetingSetting: 'AUTO', startDate: '2026-01-02' },
          ],
        },
      });

      const result = await getCampaigns('profile-123');
      expect(result).toEqual([
        { campaignId: 'c1', name: 'Campaign 1', state: 'ENABLED',
          dailyBudget: 25, campaignType: 'sponsoredProducts',
          targetingType: 'manual', startDate: '2026-01-01' },
        { campaignId: 'c2', name: 'Campaign 2', state: 'PAUSED',
          dailyBudget: 10, campaignType: 'sponsoredProducts',
          targetingType: 'auto', startDate: '2026-01-02' },
      ]);
    });

    it('should follow nextToken pagination', async () => {
      axios.post.mockResolvedValueOnce({
        data: { access_token: 'token', expires_in: 3600 },
      });
      axios.post.mockResolvedValueOnce({
        data: {
          campaigns: [{ campaignId: 'c1', name: 'A', state: 'ENABLED', budget: { budget: 1 } }],
          nextToken: 'page2',
        },
      });
      axios.post.mockResolvedValueOnce({
        data: {
          campaigns: [{ campaignId: 'c2', name: 'B', state: 'ENABLED', budget: { budget: 2 } }],
        },
      });

      const result = await getCampaigns('profile-123');
      expect(result).toHaveLength(2);
      expect(result.map(c => c.campaignId)).toEqual(['c1', 'c2']);

      // First post is the token refresh; subsequent posts are the v3 list calls.
      const listCalls = axios.post.mock.calls.filter(([url]) =>
        url === 'https://advertising-api.amazon.com/sp/campaigns/list'
      );
      expect(listCalls).toHaveLength(2);
      expect(listCalls[0][1]).toEqual({ maxResults: 100 });
      expect(listCalls[1][1]).toEqual({ maxResults: 100, nextToken: 'page2' });
    });

    it('should include profile scope and v3 headers', async () => {
      axios.post.mockResolvedValueOnce({
        data: { access_token: 'token', expires_in: 3600 },
      });
      axios.post.mockResolvedValueOnce({ data: { campaigns: [] } });

      await getCampaigns('profile-456');

      const listCall = axios.post.mock.calls.find(([url]) =>
        url === 'https://advertising-api.amazon.com/sp/campaigns/list'
      );
      expect(listCall[2].headers['Amazon-Advertising-API-Scope']).toBe('profile-456');
      expect(listCall[2].headers['Content-Type']).toBe('application/vnd.spCampaign.v3+json');
      expect(listCall[2].headers.Accept).toBe('application/vnd.spCampaign.v3+json');
    });

    it('should propagate v3 endpoint errors', async () => {
      axios.post.mockResolvedValueOnce({
        data: { access_token: 'token', expires_in: 3600 },
      });

      const error = new Error('Not Found');
      error.response = { status: 404 };
      axios.post.mockRejectedValueOnce(error);

      await expect(getCampaigns('profile-123')).rejects.toThrow();
    });
  });

  describe('Error Handling', () => {
    it('should handle network timeouts', async () => {
      axios.post.mockRejectedValueOnce(new Error('ETIMEDOUT'));
      await expect(getProfiles()).rejects.toThrow();
    });

    it('should handle connection refused', async () => {
      axios.post.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      await expect(getProfiles()).rejects.toThrow();
    });

    it('should preserve error messages', async () => {
      const originalError = new Error('Custom API error message');
      axios.post.mockRejectedValueOnce(originalError);

      await expect(getProfiles()).rejects.toThrow('Custom API error message');
    });

    it('is resilient when a region returns a malformed/failed response', async () => {
      axios.post.mockResolvedValueOnce({
        data: { access_token: 'token', expires_in: 3600 },
      });

      // NA succeeds; the other regions fail — getProfiles tolerates per-region
      // failures and still returns the regions that worked (never throws here).
      axios.get
        .mockResolvedValueOnce({ data: [{ profileId: 1, countryCode: 'US' }] })
        .mockRejectedValue(new SyntaxError('Unexpected token <'));

      const result = await getProfiles();
      expect(result).toEqual([{ profileId: 1, countryCode: 'US' }]);
    });
  });
});
