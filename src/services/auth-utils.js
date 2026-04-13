/**
 * Shared token refresh logic for Amazon APIs
 * Eliminates duplicate code between amazon-ads.js and amazon-sp-api.js
 */

import axios from 'axios';

/**
 * Create a token manager for an Amazon API service
 * Handles token refresh with caching and expiry
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
