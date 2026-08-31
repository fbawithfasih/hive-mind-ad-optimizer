import express from 'express';
import { prisma } from '../../db/prisma.js';
import { requireRole } from '../middleware/requireRole.js';
import { createLogger } from '../utils/logger.js';
import { applyProfileCap } from '../../services/plan-limits.js';

const router = express.Router();
const logger = createLogger('PROFILES');

/**
 * GET /api/profiles
 *
 * Returns SellerProfiles stored for the current org (DB-scoped).
 * Falls back to an empty list if no profiles have been synced yet.
 */
router.get('/', async (req, res) => {
  try {
    const profiles = await prisma.sellerProfile.findMany({
      where: { orgId: req.tenant.orgId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });

    res.json(profiles);
  } catch (err) {
    logger.error(`List profiles error: ${err.message}`);
    res.status(500).json({ error: 'Failed to fetch profiles.' });
  }
});

/**
 * POST /api/profiles/sync — ADMIN only
 *
 * Pulls profiles from the Amazon Ads API and upserts them into SellerProfile
 * for the current org. The first profile is marked as default if none exists.
 */
router.post('/sync', requireRole('ADMIN'), async (req, res) => {
  try {
    const raw = await req.adsClient.getProfiles();

    if (!raw?.length) {
      return res.json({ synced: 0, profiles: [] });
    }

    // Check whether the org already has a default profile
    const hasDefault = await prisma.sellerProfile.findFirst({
      where: { orgId: req.tenant.orgId, isDefault: true },
    });

    // Apply the plan's profile cap to profiles being added, never to ones
    // already connected. An org that is over its cap keeps everything it has
    // working — a sync must never disconnect a profile the seller is using.
    const existing = await prisma.sellerProfile.findMany({
      where:  { orgId: req.tenant.orgId },
      select: { profileId: true },
    });
    const known = new Set(existing.map(e => e.profileId));
    const { limited, skipped } = await applyProfileCap(req.tenant.orgId, raw, known);
    const importable = limited;

    const upserted = await Promise.all(
      importable.map(async (p, i) => {
        const profileId = String(p.profileId ?? p.id);
        const isDefault = !hasDefault && i === 0;

        return prisma.sellerProfile.upsert({
          where: { orgId_profileId: { orgId: req.tenant.orgId, profileId } },
          create: {
            orgId: req.tenant.orgId,
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

    // Remove profiles that Amazon's API no longer returns for this org's credentials.
    // This cleans up stale entries from a previous agency-level sync that stored
    // multiple clients' profiles under this org.
    // Anything the cap held back must stay in the keep-list, or the cleanup
    // below would delete profiles the seller still owns.
    const returnedIds = raw.map(p => String(p.profileId ?? p.id));
    const { count: removed } = await prisma.sellerProfile.deleteMany({
      where: {
        orgId: req.tenant.orgId,
        profileId: { notIn: returnedIds },
      },
    });

    if (removed > 0) {
      logger.info(`Removed ${removed} stale profiles for org ${req.tenant.orgId}`);
    }

    logger.info(`Synced ${upserted.length} profiles for org ${req.tenant.orgId}`);
    res.json({
      synced: upserted.length,
      removed,
      profiles: upserted,
      // Named so the UI can explain the gap rather than leaving the seller to
      // wonder where their other Amazon accounts went.
      ...(skipped.length ? { skippedForPlanLimit: skipped } : {}),
    });
  } catch (err) {
    const detail = err.response?.data ?? err.message;
    logger.error(`Sync profiles error: ${err.message}`, { detail, status: err.response?.status });
    res.status(500).json({ error: 'Failed to sync profiles from Amazon.', detail });
  }
});

/**
 * PUT /api/profiles/:profileId/default — ADMIN only
 *
 * Mark a stored profile as the default for this org.
 */
router.put('/:profileId/default', requireRole('ADMIN'), async (req, res) => {
  try {
    const existing = await prisma.sellerProfile.findFirst({
      where: { orgId: req.tenant.orgId, profileId: req.params.profileId },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Profile not found for this organization.' });
    }

    // Clear existing default, then set new one
    await prisma.$transaction([
      prisma.sellerProfile.updateMany({
        where: { orgId: req.tenant.orgId },
        data: { isDefault: false },
      }),
      prisma.sellerProfile.update({
        where: { id: existing.id },
        data: { isDefault: true },
      }),
    ]);

    res.json({ ok: true, defaultProfileId: req.params.profileId });
  } catch (err) {
    logger.error(`Set default profile error: ${err.message}`);
    res.status(500).json({ error: 'Failed to update default profile.' });
  }
});

export default router;
