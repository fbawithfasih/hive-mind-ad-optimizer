/**
 * Shared token refresh logic for Amazon APIs
 * Eliminates duplicate code between amazon-ads.js and amazon-sp-api.js
 */

import { createHash } from 'crypto';
import { http, TIMEOUT_MS } from './http.js';

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
          const response = await http.post(
            'https://api.amazon.com/auth/o2/token',
            new URLSearchParams({
              grant_type: 'refresh_token',
              refresh_token: refreshToken,
              client_id: clientId,
              client_secret: clientSecret,
            }),
            {
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              // Shorter than the default: this sits on the critical path of every
              // authenticated request, so it should fail fast rather than hold one open.
              timeout: TIMEOUT_MS.token,
            }
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
 * Entries are { manager, fingerprint }. The fingerprint is what makes a stale
 * credential impossible to serve: a manager closes over the refresh token it
 * was built with, so a cache hit on a key whose credentials have since changed
 * would keep using the old token until the process restarted.
 *
 * That was not hypothetical. saveOrgCredential invalidates `sp:<orgId>`, while
 * withAmazonCredentials creates `sp:<orgId>:<marketplaceId>` — different keys,
 * so the manager serving every API request was never cleared. A seller who
 * re-authorised kept hitting Amazon with their previous refresh token.
 * Comparing credentials on lookup fixes that regardless of which key anyone
 * invalidates.
 */
const tokenManagerRegistry = new Map();

// Bounded so a long-lived process cannot accumulate one entry per org per
// marketplace forever. Eviction costs at most one extra token refresh.
const MAX_TOKEN_MANAGERS = 500;

/** Identify a credential set without keeping a second plaintext copy of it. */
function credentialFingerprint(clientId, clientSecret, refreshToken) {
  return createHash('sha256')
    .update(`${clientId ?? ''}\u0000${clientSecret ?? ''}\u0000${refreshToken ?? ''}`)
    .digest('hex');
}

/**
 * Get or create a cached token manager for the given credentials.
 *
 * A cached entry is reused only when it was built from the same credentials.
 * Anything else is discarded and rebuilt — a rotated token takes effect on the
 * next call, with no invalidation required.
 *
 * @param {string} cacheKey   - Unique, stable key (e.g. "ads:orgId")
 * @param {string} clientId
 * @param {string} clientSecret
 * @param {string} refreshToken
 * @param {string} [logPrefix]
 */
export function getOrCreateTokenManager(cacheKey, clientId, clientSecret, refreshToken, logPrefix = 'API') {
  const fingerprint = credentialFingerprint(clientId, clientSecret, refreshToken);
  const existing = tokenManagerRegistry.get(cacheKey);

  if (existing) {
    if (existing.fingerprint === fingerprint) {
      // Re-insert to move it to the end: Map iterates in insertion order, so
      // this makes eviction least-recently-used rather than oldest-created.
      tokenManagerRegistry.delete(cacheKey);
      tokenManagerRegistry.set(cacheKey, existing);
      return existing.manager;
    }
    existing.manager.invalidate();
    tokenManagerRegistry.delete(cacheKey);
  }

  const manager = createTokenManager(clientId, clientSecret, refreshToken, logPrefix);
  tokenManagerRegistry.set(cacheKey, { manager, fingerprint });

  while (tokenManagerRegistry.size > MAX_TOKEN_MANAGERS) {
    const oldest = tokenManagerRegistry.keys().next().value;
    tokenManagerRegistry.get(oldest)?.manager.invalidate();
    tokenManagerRegistry.delete(oldest);
  }

  return manager;
}

/**
 * Invalidate a cached token manager (e.g. after credential rotation).
 *
 * Also clears keys namespaced beneath it — invalidating `sp:<orgId>` drops
 * `sp:<orgId>:<marketplaceId>` too. The separator makes this unambiguous:
 * `sp:org1:` cannot match `sp:org12`.
 */
export function invalidateTokenManager(cacheKey) {
  const prefix = `${cacheKey}:`;
  for (const [key, entry] of tokenManagerRegistry) {
    if (key === cacheKey || key.startsWith(prefix)) {
      entry.manager.invalidate();
      tokenManagerRegistry.delete(key);
    }
  }
}

/** Test seam. */
export function resetTokenManagerRegistry() {
  tokenManagerRegistry.clear();
}

/** Test seam / diagnostics. */
export function tokenManagerCount() {
  return tokenManagerRegistry.size;
}
