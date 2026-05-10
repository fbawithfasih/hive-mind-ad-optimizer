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

// Paths that require an Ads API client — middleware short-circuits with 412
// when the org hasn't completed Ads OAuth.
const ADS_REQUIRED_PREFIXES = [
  '/api/campaigns',
  '/api/reports',
  '/api/search-terms',
  '/api/keywords',
  '/api/automation',
  '/api/alerts',
  '/api/profiles',
];

function pathRequiresAds(req) {
  const url = req.originalUrl || req.url || '';
  return ADS_REQUIRED_PREFIXES.some(p => url.startsWith(p));
}

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

      // Ads API uses a separate LWA app from SP-API — its refresh token must
      // come from a dedicated Ads OAuth flow. If the org hasn't completed it,
      // attach a stub that fails fast with a clear message.
      const adsClientId     = cred.adsClientId     || process.env.AMAZON_ADS_CLIENT_ID     || '';
      const adsClientSecret = cred.adsClientSecret || process.env.AMAZON_ADS_CLIENT_SECRET || '';

      if (cred.adsRefreshToken) {
        req.adsClient = createAdsClient({
          clientId:     adsClientId,
          clientSecret: adsClientSecret,
          refreshToken: cred.adsRefreshToken,
          cacheKey:     `ads:${orgId}`,
        });
        req.hasOwnAdsCreds = true;

        // Populate the region map so per-profile API calls (campaigns,
        // reports, keywords) route to the correct regional host. Without
        // this, an AU profile would be queried against the NA endpoint
        // and silently return empty data.
        try {
          const profiles = await prisma.sellerProfile.findMany({
            where:  { orgId },
            select: { profileId: true, countryCode: true },
          });
          req.adsClient.setProfileRegions(profiles);
        } catch (err) {
          logger.warn(`Failed to load profile regions for org ${orgId}: ${err.message}`);
        }
      } else if (pathRequiresAds(req)) {
        logger.warn(`Org ${orgId} hit ${req.originalUrl} without Ads OAuth — returning 412`);
        return res.status(412).json({
          error: 'Amazon Ads is not connected for this organization.',
          code: 'ADS_NOT_CONNECTED',
          action: 'Complete the Amazon Ads OAuth step in Settings.',
        });
      }
      // else: route doesn't need adsClient, leave it unset

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
