import { prisma } from '../../db/prisma.js';

const ACCESS_DENIED_RE = /\b401\b|Unauthorized|does not have access/i;

// Sponsored Ads endpoints (campaigns / reports) only work for `seller` /
// `vendor` profiles. `agency` profiles — including Amazon Attribution
// (subType: AMAZON_ATTRIBUTION) — return 404 on every Sponsored Ads call,
// so they must never be picked as the org's default profile.
function isAdvertisingProfile(p) {
  const type = p?.accountInfo?.type;
  return type === 'seller' || type === 'vendor';
}

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

  // Only prune stored rows when we have a fresh, non-empty list from Amazon.
  // An empty response (rate limit / transient failure / token blip) must NOT
  // wipe the org's entire SellerProfile table.
  if (returnedIds.length > 0) {
    await prisma.sellerProfile.deleteMany({
      where: { orgId, profileId: { notIn: returnedIds } },
    });
  } else {
    console.warn(`[syncProfilesForOrg] getProfiles returned empty for org ${orgId} — preserving existing rows`);
  }

  // Upsert what Amazon does return. Never seed `isDefault: true` on a
  // non-advertising profile (agency / Attribution) — those return 404 on
  // Sponsored Ads endpoints and would render reports/campaigns broken.
  const advertisingIds = new Set(raw.filter(isAdvertisingProfile).map(p => String(p.profileId ?? p.id)));

  const existingDefault = await prisma.sellerProfile.findFirst({
    where: { orgId, isDefault: true },
  });
  const existingDefaultIsUsable = existingDefault && advertisingIds.has(existingDefault.profileId);

  // If the current default is an Attribution/agency profile, demote it so we
  // can promote a real advertising profile below.
  if (existingDefault && !existingDefaultIsUsable) {
    await prisma.sellerProfile.update({
      where: { id: existingDefault.id },
      data: { isDefault: false },
    });
    console.warn(`[syncProfilesForOrg] demoted non-advertising default ${existingDefault.profileId} for org ${orgId}`);
  }

  // Pick the first advertising profile as the seed default if none survives.
  const seedDefaultId = existingDefaultIsUsable
    ? existingDefault.profileId
    : raw.find(isAdvertisingProfile) && String(raw.find(isAdvertisingProfile).profileId ?? raw.find(isAdvertisingProfile).id);

  await Promise.all(
    raw.map(async (p) => {
      const profileId = String(p.profileId ?? p.id);
      const isDefault = profileId === seedDefaultId;
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

  // Ensure something usable is default. Prefer advertising profiles; only
  // fall back to whatever exists if the org has none.
  const stillHasUsableDefault = await prisma.sellerProfile.findFirst({
    where: { orgId, isDefault: true, profileId: { in: [...advertisingIds] } },
  });
  if (stillHasUsableDefault) return stillHasUsableDefault.profileId;

  const firstAdvertising = await prisma.sellerProfile.findFirst({
    where: { orgId, profileId: { in: [...advertisingIds] } },
    orderBy: { profileId: 'asc' },
  });
  const promoteTarget = firstAdvertising
    ?? await prisma.sellerProfile.findFirst({ where: { orgId }, orderBy: { profileId: 'asc' } });
  if (!promoteTarget) return null;

  await prisma.sellerProfile.updateMany({
    where: { orgId, isDefault: true },
    data: { isDefault: false },
  });
  await prisma.sellerProfile.update({
    where: { id: promoteTarget.id },
    data: { isDefault: true },
  });
  return promoteTarget.profileId;
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
