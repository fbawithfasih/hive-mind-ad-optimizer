/**
 * Sample data for an org that has not connected Amazon yet.
 *
 * The trial's argument is the agent's proposals, and a new org sees nothing
 * until two Amazon consents and a profile sync are done. So every new org
 * gets one flagged profile — a fictional Jaipur seller on amazon.com — served
 * by a fixture client that never touches the network and never calls a model.
 * The moment a real profile is synced the sample is removed.
 *
 * Identity is the SellerProfile.isDemo flag, which is what every exclusion
 * asks. The reserved profileId gives the middleware a query-free check and
 * the seed a natural idempotency key.
 */

import { prisma } from '../../db/prisma.js';

export const DEMO_PROFILE_ID = 'demo-us';

/** Never collides with the daily sweep's `agent:<YYYY-MM-DD>`. */
export const DEMO_SLOT_KEY = 'agent:demo';

export const demoEnabled = () => process.env.DEMO_DATA !== 'off';

export class DemoDataError extends Error {
  constructor(what = 'change campaigns') {
    super(`Demo data is read-only — connect your Amazon account to ${what}.`);
    this.name = 'DemoDataError';
    this.code = 'DEMO_READ_ONLY';
  }
}

/**
 * Is this request about the org's demo profile?
 *
 * Only a stored, flagged row counts: a stale ?profileId=demo-us after the
 * sample was removed must not resurrect it. With no profileId on the request
 * (GET /api/campaigns resolves the default itself) the sample applies only
 * when the org has nothing real.
 *
 * @returns {Promise<boolean>}
 */
export async function isDemoRequest(req, orgId) {
  if (!demoEnabled()) return false;
  const requested = req.query?.profileId ?? req.body?.profileId;
  if (requested) {
    if (String(requested) !== DEMO_PROFILE_ID) return false;
    const row = await prisma.sellerProfile.findUnique({
      where: { orgId_profileId: { orgId, profileId: DEMO_PROFILE_ID } }, select: { isDemo: true },
    });
    return Boolean(row?.isDemo);
  }
  const real = await prisma.sellerProfile.findFirst({ where: { orgId, isDemo: false }, select: { id: true } });
  if (real) return false;
  const demo = await prisma.sellerProfile.findFirst({ where: { orgId, isDemo: true }, select: { id: true } });
  return Boolean(demo);
}
