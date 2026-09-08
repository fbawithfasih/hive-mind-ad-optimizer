/**
 * An Ads client bound to one organization's credentials.
 *
 * Pulled out of the agent worker because reverting needs the identical thing,
 * and one detail of it is easy to leave out and impossible to see: the client
 * routes every request through hostFor(profileId), which reads the regional
 * host out of whatever setProfileRegions was last given. A client built
 * without that step does not fail — it quietly asks the wrong region about a
 * profile it has never heard of. Copying four lines to a second call site is
 * how that gets lost, so there is one line to call instead.
 */

import { prisma } from '../../db/prisma.js';
import { loadOrgCredential } from '../credentials.js';
import { createAdsClient, default as defaultAdsClient } from '../amazon-ads.js';

export class NoAdsCredentialError extends Error {
  constructor(orgId) {
    super(`No Amazon Ads credential for org ${orgId}`);
    this.name = 'NoAdsCredentialError';
    this.orgId = orgId;
  }
}

/**
 * @param {string} orgId
 * @returns {Promise<object>} an Ads client that knows this org's profile regions
 * @throws {NoAdsCredentialError} when the org has never connected Amazon
 */
export async function adsClientForOrg(orgId) {
  const cred = await loadOrgCredential(orgId);
  if (!cred?.adsClientId) throw new NoAdsCredentialError(orgId);

  const client = createAdsClient({
    clientId:     cred.adsClientId,
    clientSecret: cred.adsClientSecret,
    refreshToken: cred.adsRefreshToken,
    cacheKey:     `ads:${orgId}`,
  }) ?? defaultAdsClient;

  const regions = await prisma.sellerProfile.findMany({
    where: { orgId }, select: { profileId: true, countryCode: true },
  });
  client.setProfileRegions?.(regions);

  return client;
}

export default adsClientForOrg;
