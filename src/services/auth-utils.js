/**
 * Shared token refresh logic for Amazon APIs
 * Eliminates duplicate code between amazon-ads.js and amazon-sp-api.js
 */

import axios from 'axios';

/**
 * Create a token manager for an Amazon API service.
 * Handles token refresh with in-memory caching and expiry.
 */
export function createTokenManager(clientId, clientSecret, refreshToken, logPrefix = 'API') {
  let cachedToken = null;
  let tokenExpiry = null;
  let refreshPromise = null; // Prevent race conditions on simultaneous refresh

  return {
    async getToken() {
      // Return cached token if still valid
      if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
        return cachedToken;
      }

      // Prevent duplicate refresh requests
      if (refreshPromise) {
        return refreshPromise;
      }

      // Without this the request goes out with empty credentials and Amazon
      // answers a bare 400, which surfaces to the user as an opaque failure.
      // The actual cause is almost always an account that was never connected.
      if (!clientId || !clientSecret || !refreshToken) {
        throw new Error(
          `Amazon credentials not configured for ${logPrefix}. ` +
          'Connect your Amazon account under Settings → Amazon Account.'
        );
      }

      refreshPromise = (async () => {
        try {
          const response = await axios.post(
            'https://api.amazon.com/auth/o2/token',
            new URLSearchParams({
              grant_type: 'refresh_token',
              refresh_token: refreshToken,
              client_id: clientId,
              client_secret: clientSecret,
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
          );

          cachedToken = response.data.access_token;
          // Set expiry 1 minute before actual expiry to avoid edge cases
          tokenExpiry = Date.now() + response.data.expires_in * 1000 - 60000;
          console.log(`✅ ${logPrefix} access token refreshed`);
          return cachedToken;
        } finally {
          refreshPromise = null; // Clear the refresh promise
        }
      })();

      return refreshPromise;
    },

    invalidate() {
      cachedToken = null;
      tokenExpiry = null;
    },
  };
}

/**
 * Module-level registry of token managers keyed by a stable cache key.
 * Allows per-org token managers to be reused across requests without
 * creating a new HTTP round-trip on every call.
 *
 * Key format: "<apiType>:<clientId>:<refreshTokenSuffix>"
 */
const tokenManagerRegistry = new Map();

/**
 * Get or create a cached token manager for the given credentials.
 *
 * @param {string} cacheKey   - Unique, stable key (e.g. "ads:orgId:abc123")
 * @param {string} clientId
 * @param {string} clientSecret
 * @param {string} refreshToken
 * @param {string} [logPrefix]
 */
export function getOrCreateTokenManager(cacheKey, clientId, clientSecret, refreshToken, logPrefix = 'API') {
  if (!tokenManagerRegistry.has(cacheKey)) {
    tokenManagerRegistry.set(
      cacheKey,
      createTokenManager(clientId, clientSecret, refreshToken, logPrefix)
    );
  }
  return tokenManagerRegistry.get(cacheKey);
}

/**
 * Invalidate a cached token manager (e.g. after credential rotation).
 */
export function invalidateTokenManager(cacheKey) {
  const manager = tokenManagerRegistry.get(cacheKey);
  if (manager) {
    manager.invalidate();
    tokenManagerRegistry.delete(cacheKey);
  }
}
