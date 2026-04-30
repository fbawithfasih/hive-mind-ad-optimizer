import { prisma } from '../../db/prisma.js';

const ACCESS_DENIED_RE = /\b401\b|Unauthorized|does not have access/i;

export function isProfileAccessDenied(err) {
  return ACCESS_DENIED_RE.test(err?.message ?? '');
}

/**
 * Pull the org's currently accessible Amazon profiles and upsert them.
 * Removes any stored rows the org's OAuth no longer sees and promotes the
 * first remaining profile to default if the previous default was pruned.
 *
 * Returns the new default profileId (or null if the org has no profiles).
 */
export async function syncProfilesForOrg(orgId, adsClient) {
  if (!orgId || !adsClient) return null;

  let raw;
  try {
    raw = await adsClient.getProfiles();
  } catch (e) {
    console.error(`[syncProfilesForOrg] getProfiles failed for org ${orgId}: ${e.message}`);
    return null;
  }
  if (!Array.isArray(raw)) raw = [];

  const returnedIds = raw.map(p => String(p.profileId ?? p.id));

  // Remove rows Amazon no longer returns for this org's creds
  await prisma.sellerProfile.deleteMany({
    where: {
      orgId,
      profileId: returnedIds.length ? { notIn: returnedIds } : undefined,
    },
  });

  // Upsert what Amazon does return
  const hasDefault = await prisma.sellerProfile.findFirst({
    where: { orgId, isDefault: true },
  });

  await Promise.all(
    raw.map(async (p, i) => {
      const profileId = String(p.profileId ?? p.id);
      const isDefault = !hasDefault && i === 0;
      await prisma.sellerProfile.upsert({
        where: { orgId_profileId: { orgId, profileId } },
        create: {
          orgId,
          profileId,
          profileName: p.accountInfo?.name ?? p.name ?? profileId,
          accountId:   p.accountInfo?.id   ?? null,
          accountName: p.accountInfo?.name ?? p.name ?? null,
          countryCode: p.countryCode ?? '',
          primaryCountry: p.countryCode ?? '',
          isDefault,
          lastSyncedAt: new Date(),
        },
        update: {
          profileName: p.accountInfo?.name ?? p.name ?? profileId,
          accountId:   p.accountInfo?.id   ?? null,
          accountName: p.accountInfo?.name ?? p.name ?? null,
          countryCode: p.countryCode ?? '',
          primaryCountry: p.countryCode ?? '',
          lastSyncedAt: new Date(),
        },
      });
    })
  );

  // Ensure something is default
  const stillHasDefault = await prisma.sellerProfile.findFirst({
    where: { orgId, isDefault: true },
  });
  if (!stillHasDefault) {
    const first = await prisma.sellerProfile.findFirst({ where: { orgId } });
    if (first) {
      await prisma.sellerProfile.update({
        where: { id: first.id },
        data: { isDefault: true },
      });
      return first.profileId;
    }
    return null;
  }

  return stillHasDefault.profileId;
}

/**
 * Delete a SellerProfile row that the org's current Ads OAuth can no longer
 * access, then re-sync from Amazon so the org ends up with a usable profile
 * without manual intervention.
 *
 * Returns the new default profileId, or null if the org has none accessible.
 */
export async function pruneInaccessibleProfile(orgId, profileId, adsClient) {
  if (!orgId || !profileId) return null;
  try {
    await prisma.sellerProfile.deleteMany({
      where: { orgId, profileId: String(profileId) },
    });
    console.warn(`[pruneInaccessibleProfile] Removed stale profile ${profileId} for org ${orgId}`);
  } catch (e) {
    console.error(`[pruneInaccessibleProfile] delete failed for org ${orgId}/${profileId}: ${e.message}`);
    return null;
  }

  if (!adsClient) return null;
  return syncProfilesForOrg(orgId, adsClient);
}
