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
import { marketplaceIdForCountry, languageTagForCountry } from '../utils/marketplaces.js';
import { prisma } from '../../db/prisma.js';

const logger = createLogger('CREDS_MW');

/**
 * Resolve the marketplace ID for the current request.
 *
 * Priority:
 *   1. profileId query param / body → look up SellerProfile.countryCode in DB
 *   2. Org-level credential.marketplaceId
 *   3. Hard-coded US fallback
 */
async function resolveMarketplaceContext(req, orgId, credMarketplaceId) {
  const profileId = req.query?.profileId || req.body?.profileId;
  if (profileId) {
    try {
      const profile = await prisma.sellerProfile.findUnique({
        where: { orgId_profileId: { orgId, profileId: String(profileId) } },
        select: { countryCode: true },
      });
      if (profile?.countryCode) {
        const mid = marketplaceIdForCountry(profile.countryCode);
        const lng = languageTagForCountry(profile.countryCode);
        logger.debug(`Marketplace resolved from profile ${profileId} (${profile.countryCode}): ${mid}`);
        return { marketplaceId: mid, languageTag: lng };
      }
    } catch (e) {
      logger.warn(`Could not resolve marketplace for profileId ${profileId}: ${e.message}`);
    }
  }
  return { marketplaceId: credMarketplaceId ?? 'ATVPDKIKX0DER', languageTag: 'en_US' };
}

export async function withAmazonCredentials(req, res, next) {
  try {
    const orgId = req.tenant?.orgId;
    if (!orgId) return next();

    const cred = await loadOrgCredential(orgId);

    if (cred) {
      const { marketplaceId, languageTag } = await resolveMarketplaceContext(req, orgId, cred.marketplaceId);

      req.adsClient = cred.adsClientId
        ? createAdsClient({
            clientId:     cred.adsClientId,
            clientSecret: cred.adsClientSecret,
            refreshToken: cred.adsRefreshToken,
            cacheKey:     `ads:${orgId}`,
          })
        : defaultAdsClient;

      req.spClient = createSpApiClient({
        clientId:      cred.spClientId,
        clientSecret:  cred.spClientSecret,
        refreshToken:  cred.spRefreshToken,
        sellerId:      cred.sellerId,
        marketplaceId,
        languageTag,
        cacheKey:      `sp:${orgId}:${marketplaceId}`,
      });

      logger.debug(`Loaded per-org Amazon credentials for org ${orgId}, marketplace ${marketplaceId}`);
    } else {
      req.adsClient = defaultAdsClient;
      req.spClient  = defaultSpClient;
      logger.debug(`No credentials for org ${orgId} — using env-var defaults`);
    }

    next();
  } catch (err) {
    logger.error(`withAmazonCredentials error: ${err.message}`);
    req.adsClient = defaultAdsClient;
    req.spClient  = defaultSpClient;
    next();
  }
}

export default withAmazonCredentials;
