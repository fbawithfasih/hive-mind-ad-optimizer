/**
 * Middleware: attach per-org Amazon API clients to the request.
 *
 * Loads the current org's AmazonCredential from the database, decrypts the
 * tokens, and creates client instances bound to those credentials.
 *
 * Attaches:
 *   req.adsClient  — Amazon Ads API client (campaigns, reports, search terms)
 *   req.spClient   — SP-API client (listings, catalog)
 *
 * Falls back to the default env-var-backed clients if the org has no stored
 * credential yet (so existing single-tenant deployments keep working).
 *
 * Must be used after requireAuth + withTenant middleware.
 */

import { loadOrgCredential } from '../../services/credentials.js';
import { createAdsClient, default as defaultAdsClient } from '../../services/amazon-ads.js';
import { createSpApiClient, default as defaultSpClient } from '../../services/amazon-sp-api.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('CREDS_MW');

export async function withAmazonCredentials(req, res, next) {
  try {
    const orgId = req.tenant?.orgId;
    if (!orgId) return next(); // No tenant context — skip (shouldn't happen in normal flow)

    const cred = await loadOrgCredential(orgId);

    if (cred) {
      // Build per-org SP client using the org's own SP-API refresh token.
      // For Ads API, only build a per-org client if we have Ads credentials;
      // otherwise fall back to the global env-var client.
      req.adsClient = cred.adsClientId
        ? createAdsClient({
            clientId:     cred.adsClientId,
            clientSecret: cred.adsClientSecret,
            refreshToken: cred.adsRefreshToken,
            cacheKey:     `ads:${orgId}`,
          })
        : defaultAdsClient;

      req.spClient = createSpApiClient({
        clientId:     cred.spClientId,
        clientSecret: cred.spClientSecret,
        refreshToken: cred.spRefreshToken,
        sellerId:     cred.sellerId,
        marketplaceId: cred.marketplaceId,
        cacheKey:     `sp:${orgId}`,
      });

      logger.debug(`Loaded per-org Amazon credentials for org ${orgId}`);
    } else {
      // No credential stored — fall back to global env-var clients
      req.adsClient = defaultAdsClient;
      req.spClient  = defaultSpClient;

      logger.debug(`No credentials for org ${orgId} — using env-var defaults`);
    }

    next();
  } catch (err) {
    logger.error(`withAmazonCredentials error: ${err.message}`);
    // Don't block the request — attach defaults and continue
    req.adsClient = defaultAdsClient;
    req.spClient  = defaultSpClient;
    next();
  }
}

export default withAmazonCredentials;
