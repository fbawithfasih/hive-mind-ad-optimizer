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

      const mockProfiles = [
        { id: '1', name: 'Profile 1', type: 'seller' },
        { id: '2', name: 'Profile 2', type: 'brand' },
      ];

      axios.get.mockResolvedValueOnce({
        data: mockProfiles,
      });

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
    it('should fetch campaigns for profile', async () => {
      axios.post.mockResolvedValueOnce({
        data: {
          access_token: 'token',
          expires_in: 3600,
        },
      });

      const mockCampaigns = [
        { id: 'c1', name: 'Campaign 1', state: 'enabled' },
        { id: 'c2', name: 'Campaign 2', state: 'paused' },
      ];

      axios.get.mockResolvedValueOnce({
        data: mockCampaigns,
      });

      const result = await getCampaigns('profile-123');
      expect(result).toEqual(mockCampaigns);
    });

    it('should include profile scope in headers', async () => {
      axios.post.mockResolvedValueOnce({
        data: { access_token: 'token', expires_in: 3600 },
      });

      axios.get.mockResolvedValueOnce({
        data: [],
      });

      await getCampaigns('profile-456');

      const getCall = axios.get.mock.calls[0];
      expect(getCall[1].headers).toHaveProperty('Amazon-Advertising-API-Scope');
      expect(getCall[1].headers['Amazon-Advertising-API-Scope']).toBe('profile-456');
    });

    it('should handle campaigns endpoint not found', async () => {
      axios.post.mockResolvedValueOnce({
        data: { access_token: 'token', expires_in: 3600 },
      });

      const error = new Error('Not Found');
      error.response = { status: 404 };
      axios.get.mockRejectedValueOnce(error);

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

    it('should handle malformed JSON responses', async () => {
      axios.post.mockResolvedValueOnce({
        data: { access_token: 'token', expires_in: 3600 },
      });

      axios.get.mockRejectedValueOnce(new SyntaxError('Unexpected token <'));
      await expect(getProfiles()).rejects.toThrow();
    });
  });
});
