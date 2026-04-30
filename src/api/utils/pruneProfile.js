import { prisma } from '../../db/prisma.js';

const ACCESS_DENIED_RE = /\b401\b|Unauthorized|does not have access/i;

export function isProfileAccessDenied(err) {
  return ACCESS_DENIED_RE.test(err?.message ?? '');
}

/**
 * Delete a SellerProfile row that the org's current Ads OAuth can no longer
 * access. Promotes another profile to default if the pruned one was default.
 */
export async function pruneInaccessibleProfile(orgId, profileId) {
  if (!orgId || !profileId) return;
  try {
    const existing = await prisma.sellerProfile.findUnique({
      where: { orgId_profileId: { orgId, profileId: String(profileId) } },
    });
    if (!existing) return;

    await prisma.sellerProfile.delete({
      where: { orgId_profileId: { orgId, profileId: String(profileId) } },
    });
    console.warn(`[pruneInaccessibleProfile] Removed stale profile ${profileId} for org ${orgId}`);

    if (existing.isDefault) {
      const next = await prisma.sellerProfile.findFirst({ where: { orgId } });
      if (next) {
        await prisma.sellerProfile.update({
          where: { id: next.id },
          data: { isDefault: true },
        });
        console.warn(`[pruneInaccessibleProfile] Promoted ${next.profileId} to default for org ${orgId}`);
      }
    }
  } catch (e) {
    console.error(`[pruneInaccessibleProfile] failed for org ${orgId}/${profileId}: ${e.message}`);
  }
}
